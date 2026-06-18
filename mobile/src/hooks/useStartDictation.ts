import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback } from "react";

import { EkweError, ErrorMessages } from "@/constants/errors";
import type { UseDictationStateReturn } from "@/hooks/useDictationState";
import { AudioCapture } from "@/services/AudioCapture";
import { audioActions, RecordingState } from "@/store/audio";
import { AnalyticsEvents, track } from "@/utils/analytics";
import logger from "@/utils/logger";

/**
 * useStartDictation — Extracted recording start logic.
 * Handles permission check, session init, recording start, and auto-stop timeout.
 */
export function useStartDictation(
  state: UseDictationStateReturn,
  permissions: { dictationDurationMs: number },
): (sourceLang: string) => Promise<void> {
  const {
    statusRef,
    setStatus,
    setError,
    setNativeWaveform,
    sourceLangRef,
    capturedUriRef,
    capturedNativeWaveformRef,
    maxDurationTimeoutRef,
    stopDictationRef,
  } = state;
  const maxDurationMs = permissions.dictationDurationMs;

  return useCallback(
    async (sourceLang: string): Promise<void> => {
      if (statusRef.current === "error" || statusRef.current === "preview") {
        if (capturedUriRef.current) {
          FileSystem.deleteAsync(capturedUriRef.current, {
            idempotent: true,
          }).catch((err) =>
            logger.debug(
              "[VoiceDictation] deleteAsync preview file on reset failed",
              err,
            ),
          );
          capturedUriRef.current = null;
        }
        setStatus("idle");
        setError(null);
      }

      if (statusRef.current !== "idle") {
        logger.warn(
          "[VoiceDictation] startDictation called while status is:",
          statusRef.current,
        );
        return;
      }

      logger.info("[VoiceDictation] Starting dictation, lang:", sourceLang);
      sourceLangRef.current = sourceLang;
      setError(null);

      setStatus("initializing");
      setNativeWaveform([]);
      capturedNativeWaveformRef.current = [];

      const permResult = await AudioCapture.requestPermission();
      if (!permResult.ok) {
        logger.warn("[VoiceDictation] Microphone permission denied");
        setError(ErrorMessages[EkweError.PERMISSION_MIC]);
        setStatus("error");
        return;
      }

      const sessionId = Crypto.randomUUID();
      audioActions.setSessionId(sessionId);
      audioActions.setSourceLang(sourceLang);
      audioActions.setRecordingState(RecordingState.Recording);

      const startResult = await AudioCapture.startRecording(
        sessionId,
        stopDictationRef.current,
      );
      if (!startResult.ok) {
        logger.error(
          "[VoiceDictation] startRecording failed:",
          startResult.error,
        );
        setError(
          ErrorMessages[startResult.error] ??
            ErrorMessages[EkweError.AUDIO_RECORD_FAIL],
        );
        setStatus("error");
        return;
      }

      setStatus("recording");
      track(AnalyticsEvents.DICTATION_STARTED, {
        sourceLang,
        maxDurationMs,
      });
      logger.info(
        "[VoiceDictation] Recording started, maxDuration:",
        maxDurationMs,
        "ms",
      );

      maxDurationTimeoutRef.current = setTimeout(() => {
        logger.info("[VoiceDictation] Max duration reached, auto-stopping");
        stopDictationRef.current();
      }, maxDurationMs);
    },
    [maxDurationMs],
  );
}
