import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import EkweNative from "../../modules/ekwe-native";

import { AudioProcessor } from "@/services/AudioProcessor";
import { HistoryService } from "@/services/HistoryService";
import { transcribeAudio } from "@/services/transcribeAudio";
import { translateText } from "@/services/translateText";
import { audioActions } from "@/store/audio";
import { auth$ } from "@/store/auth";
import { settings$ } from "@/store/settings";
import { BubbleNative } from "@/utils/BubbleModule";
import logger from "@/utils/logger";

// Module-level abort controller for background echo sessions
let echoSessionAbort: AbortController | null = null;

// Standalone function to prevent stale closures in the component lifecycle
export const handleEchoSession = async (
  uri: string,
  sourceApp: string = "Unknown App",
): Promise<void> => {
  // Cancel any previous background session
  echoSessionAbort?.abort();
  echoSessionAbort = new AbortController();
  const signal = echoSessionAbort.signal;
  const userSession = auth$.session.get();

  if (!userSession) {
    logger.warn(
      "[EkweEcho] Aborting background transcription: User is not authenticated",
    );
    BubbleNative.dismissOverlay();
    return;
  }

  logger.info(
    `[EkweEcho] App in background — transcribing voice from ${sourceApp}`,
  );

  try {
    // 1. Instant Feedback: Show "MAGIC" state (sparkles) so user knows it started
    BubbleNative.updateState("MAGIC");
    audioActions.setActiveFloatingHead("card");

    // GOTCHA 3: Prevent Nitro / CPU Thread Throttling
    await activateKeepAwakeAsync("ekweEcho");

    // 2. Validate and compute averageDb
    const processResult = await AudioProcessor.processRecording(uri, 0, []);
    const processedAudio = processResult.ok
      ? processResult.value
      : { uri, durationMs: 0, averageDb: -40, meteringData: [], waveform: [] };

    // 3. Perform background transcription
    const transcriptionResult = await transcribeAudio(
      processedAudio,
      "auto",
      signal,
    );

    if (signal.aborted) return;

    if (transcriptionResult.ok) {
      const data = transcriptionResult.value;
      // Resolve the actual detected language (sourceLang may be "auto")
      const effectiveSource = data.detectedLang || "en";
      // 3. Chain Translation
      const targetLang = settings$.targetLanguage.get() || "en";
      const translationResult = await translateText(
        data.transcript,
        effectiveSource,
        targetLang,
        signal,
      );

      if (signal.aborted) return;

      // 4. Persistence to History (Crucial: Background sessions must be saved)
      await HistoryService.recordTranslation(
        {
          sourceLang: effectiveSource,
          targetLang,
          transcript: data.transcript,
          translation: translationResult.ok
            ? translationResult.value.translation
            : null,
          transliteration: null,
          duration: data.durationSeconds,
          sourceApp,
          provider: "gemini",
          sessionKey: uri,
        },
        userSession as Parameters<typeof HistoryService.recordTranslation>[1],
      );

      // 5. Dismiss Overlay
      BubbleNative.dismissOverlay();
    } else {
      logger.error("[EkweEcho] Background transcription failed");
    }
  } catch (err) {
    logger.error("[EkweEcho] Fatal session error:", err);
  } finally {
    // Always release Wakelock
    try {
      deactivateKeepAwake("ekweEcho");
    } catch {
      /* Activity may be destroyed */
    }
    // CLEANUP: Deleting the audio cache after processing is done
    EkweNative?.deleteFile(uri);
    BubbleNative.updateState("IDLE");
  }
};
