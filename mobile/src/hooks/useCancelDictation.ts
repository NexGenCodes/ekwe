import * as FileSystem from "expo-file-system/legacy";
import { useCallback } from "react";

import type { UseDictationStateReturn } from "@/hooks/useDictationState";
import { AudioCapture } from "@/services/AudioCapture";
import { audioActions } from "@/store/audio";
import { AnalyticsEvents, track } from "@/utils/analytics";
import logger from "@/utils/logger";

/**
 * useCancelDictation — Extracted dictation cancellation logic.
 * Handles cleanup of temp files, aborts, and state reset.
 */
export function useCancelDictation(
  state: UseDictationStateReturn,
  clearTimers: () => void,
): () => Promise<void> {
  const {
    statusRef,
    setStatus,
    setError,
    setMeteringData,
    setNativeWaveform,
    abortControllerRef,
    capturedUriRef,
    capturedDurationRef,
    capturedNativeWaveformRef,
    manualStopRef,
  } = state;

  const cleanupTempFiles = useCallback(async (cancelResultUri?: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const deletions: Promise<void>[] = [];

    if (cancelResultUri) {
      deletions.push(
        FileSystem.deleteAsync(cancelResultUri, { idempotent: true }).catch(
          (e) =>
            logger.error("[VoiceDictation] Failed to cleanup recording:", e),
        ),
      );
    }

    if (capturedUriRef.current) {
      const uri = capturedUriRef.current;
      capturedUriRef.current = null;
      deletions.push(
        FileSystem.deleteAsync(uri, { idempotent: true }).catch((err) =>
          logger.debug("[VoiceDictation] deleteAsync preview file failed", err),
        ),
      );
    }

    if (deletions.length > 0) await Promise.all(deletions);
  }, []);

  return useCallback(async (): Promise<void> => {
    logger.info(
      "[VoiceDictation] Cancelling dictation, status:",
      statusRef.current,
    );
    track(AnalyticsEvents.DICTATION_CANCELLED, {
      status: statusRef.current,
      durationMs: capturedDurationRef.current,
    });
    clearTimers();
    manualStopRef.current = true;

    let partialUri: string | undefined;
    if (AudioCapture.isRecording()) {
      const cancelResult = await AudioCapture.cancelRecording();
      if (cancelResult.ok && cancelResult.value) {
        partialUri = cancelResult.value;
      }
    }
    manualStopRef.current = false;

    await cleanupTempFiles(partialUri);
    setStatus("idle");
    setError(null);
    setMeteringData([]);
    setNativeWaveform([]);
    capturedNativeWaveformRef.current = [];
    audioActions.resetAudioState();
  }, [clearTimers, cleanupTempFiles]);
}
