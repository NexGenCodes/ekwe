import { useSelector } from "@legendapp/state/react";
import { useEventListener } from "expo";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useRouter, useRootNavigationState } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";
import { AppState } from "react-native";

import EkweNative from "../../../modules/ekwe-native";

import { AudioCapture } from "@/services/AudioCapture";
import { HistoryService } from "@/services/HistoryService";
import { transcribeAudio } from "@/services/transcribeAudio";
import { translateText } from "@/services/translateText";
import { auth$, audioActions, settings$ } from "@/store";
import { logger, isAndroid } from "@/utils";
import { BubbleNative } from "@/utils/BubbleModule";
import { AppAlert } from "@/utils/alert";

// Module-level abort controller for background echo sessions
let echoSessionAbort: AbortController | null = null;

// Standalone function to prevent stale closures in the component lifecycle
const handleEchoSession = async (
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

    // 2. Perform background transcription
    const transcriptionResult = await transcribeAudio(
      {
        uri,
        durationMs: 0,
        averageDb: -40,
        meteringData: [],
      },
      "auto",
      signal,
    );

    if (signal.aborted) return;

    if (transcriptionResult.ok) {
      const data = transcriptionResult.value;
      // 3. Chain Translation
      const targetLang = settings$.targetLanguage.get() || "en";
      const translationResult = await translateText(
        data.transcript,
        "auto",
        targetLang,
        signal,
      );

      if (signal.aborted) return;

      // 4. Persistence to History (Crucial: Background sessions must be saved)
      await HistoryService.recordTranslation(
        {
          sourceLang: data.sourceLang,
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

export const useShareIntentHandler = (): void => {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntent({
      disabled: isAndroid,
    });

  useEffect((): void => {
    if (error) {
      logger.error("[ShareIntent] Error:", error);
    }
  }, [error]);

  // NATIVE QUEUE Bridge: Process intents intercepted by Ekwe Echo (ShareActivity)
  useEventListener(
    EkweNative,
    "onIntentQueued",
    async (event: { audioPath: string; sourceApp: string }): Promise<void> => {
      logger.info(`[ShareIntent] Native Intent Received: ${event.audioPath}`);

      const userSession = auth$.session.get();
      if (!userSession) {
        logger.warn("[ShareIntent] User not authenticated. Rejecting intent.");
        AppAlert.info(
          "Login Required",
          "Please open Ekwe to log in before translating shared items.",
        );
        BubbleNative.dismissOverlay();
        if (AppState.currentState === "active") {
          router.replace("/(auth)");
        }
        return;
      }

      let filePath = event.audioPath;
      if (isAndroid && filePath.startsWith("content://")) {
        const resolved = await BubbleNative.resolveContentUri(filePath);
        if (resolved) filePath = resolved;
      }

      const mimeType = "audio/*";
      const isBackground = AppState.currentState !== "active";

      const result = await AudioCapture.processSharedFile(filePath, mimeType);

      if (result.ok) {
        if (isAndroid && isBackground) {
          handleEchoSession(result.value.uri, event.sourceApp);
        } else {
          router.push({
            pathname: "/result",
            params: {
              uri: result.value.uri,
              sourceApp: event.sourceApp || "shared",
            },
          });
        }
      } else {
        AppAlert.error(
          "Unsupported Format",
          "Ekwe only supports voice note formats.",
        );
        BubbleNative.dismissOverlay();
      }
    },
  );

  useEffect((): void => {
    // Wait for the navigation root to be mounted (only for foreground routing)
    const isBackground = AppState.currentState !== "active";
    if (!navigationState?.key && !isBackground) return;

    if (hasShareIntent && shareIntent.type) {
      const userSession = auth$.session.get();

      if (!onboardingCompleted || !userSession) {
        logger.warn(
          "[ShareIntent] User not authenticated or not onboarded. Skipping share processing.",
        );
        AppAlert.info(
          "Login Required",
          "Please open Ekwe to log in before translating shared items.",
        );
        resetShareIntent();
        router.replace("/(auth)");
        return;
      }

      if (shareIntent.type === "text" && shareIntent.text) {
        router.push({
          pathname: "/translate",
          params: {
            text: shareIntent.text,
            detectedLang: "en",
          },
        });
        resetShareIntent();
      } else if (shareIntent.type === "file" && shareIntent.files) {
        const validFiles = shareIntent.files.filter(
          (f) => f && typeof f === "object" && "path" in f,
        );
        if (validFiles.length === 0) return;

        const file = validFiles[0];
        resetShareIntent();

        const isBackgroundApp = AppState.currentState !== "active";

        const processFile = async (): Promise<void> => {
          let filePath = file.path;

          if (isAndroid && filePath.startsWith("content://")) {
            const resolved = await BubbleNative.resolveContentUri(filePath);
            if (resolved) filePath = resolved;
          }

          const result = await AudioCapture.processSharedFile(
            filePath,
            file.mimeType,
          );

          if (result.ok) {
            if (isAndroid && isBackgroundApp) {
              BubbleNative.showOverlay(result.value.uri, "Unknown App");
              handleEchoSession(result.value.uri, "Unknown App");
            } else {
              router.push({
                pathname: "/result",
                params: {
                  uri: result.value.uri,
                  sourceApp: "shared",
                },
              });
            }
          } else {
            AppAlert.error(
              "Unsupported Format",
              "Ekwe only supports voice note formats (.opus, .m4a, .ogg).",
            );
          }
        };

        processFile();
      }
    }
  }, [
    hasShareIntent,
    shareIntent,
    router,
    navigationState?.key,
    onboardingCompleted,
    resetShareIntent,
  ]);
};
