import * as FileSystem from "expo-file-system/legacy";
import { useCallback } from "react";

import { EkweError, ErrorMessages } from "@/constants/errors";
import type { UseDictationStateReturn } from "@/hooks/useDictationState";
import { batchTranscriber } from "@/services/BatchTranscriber";
import { audioActions, RecordingState } from "@/store/audio";
import { AnalyticsEvents, track } from "@/utils/analytics";
import logger from "@/utils/logger";

export type ConfirmResult = {
  transcript: string;
  detectedLang: string;
} | null;

export function useTranscriptionPipeline(
  state: UseDictationStateReturn,
): (sourceLang: string) => Promise<ConfirmResult> {
  const {
    statusRef,
    setStatus,
    setError,
    setMeteringData,
    setNativeWaveform,
    abortControllerRef,
    sourceLangRef,
    capturedUriRef,
    capturedMeteringRef,
    capturedDurationRef,
    capturedNativeWaveformRef,
  } = state;

  return useCallback(
    async (sourceLang: string): Promise<ConfirmResult> => {
      const uri = capturedUriRef.current;
      if (!uri || statusRef.current !== "preview") {
        logger.warn(
          "[VoiceDictation] confirmDictation called without valid preview",
        );
        return null;
      }

      setStatus("processing");
      track(AnalyticsEvents.TRANSCRIBING_STARTED, {
        sourceLang: sourceLangRef.current,
        durationMs: capturedDurationRef.current,
      });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        logger.info("[VoiceDictation] Confirming dictation, uri:", uri);

        const result = await batchTranscriber.transcribe(
          {
            uri,
            durationMs: capturedDurationRef.current,
            meteringData: capturedMeteringRef.current,
            waveform: capturedNativeWaveformRef.current,
          },
          sourceLang,
          controller.signal,
        );

        abortControllerRef.current = null;

        if (!result.ok) {
          if (controller.signal.aborted) {
            logger.info("[VoiceDictation] Transcription aborted");
            return null;
          }
          const msg = ErrorMessages[result.error] ?? "Transcription failed.";
          logger.error("[VoiceDictation] Transcription failed:", result.error);
          setError(msg);
          setStatus("error");
          audioActions.setError(result.error as EkweError);
          track(AnalyticsEvents.TRANSCRIPTION_FAILED, {
            sourceLang: sourceLangRef.current,
            durationMs: capturedDurationRef.current,
            error: EkweError.TRANSCRIPTION_FAIL,
          });
          return null;
        }

        const { transcript, detectedLang } = result.value;

        if (capturedNativeWaveformRef.current.length > 0) {
          setNativeWaveform(capturedNativeWaveformRef.current);
        }

        track(AnalyticsEvents.TRANSCRIBING_COMPLETED, {
          sourceLang: sourceLangRef.current,
          durationMs: capturedDurationRef.current,
          detectedLang,
        });
        logger.info("[VoiceDictation] Transcription success");
        audioActions.appendTranscript(transcript);
        audioActions.setRecordingState(RecordingState.Done);

        setStatus("idle");
        setMeteringData([]);
        capturedUriRef.current = null;
        return { transcript, detectedLang };
      } catch (err) {
        abortControllerRef.current = null;
        logger.error("[VoiceDictation] Confirm error:", err);
        track(AnalyticsEvents.TRANSCRIPTION_FAILED, {
          sourceLang: sourceLangRef.current,
          durationMs: capturedDurationRef.current,
          error: "exception",
        });
        setError("Failed to process voice input.");
        setStatus("error");
        return null;
      } finally {
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    },
    [
      abortControllerRef,
      capturedDurationRef,
      capturedMeteringRef,
      capturedNativeWaveformRef,
      capturedUriRef,
      setError,
      setMeteringData,
      setNativeWaveform,
      setStatus,
      sourceLangRef,
      statusRef,
    ],
  );
}
