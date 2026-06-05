import * as FileSystem from "expo-file-system/legacy";
import { useCallback } from "react";

import { EkweError, ErrorMessages } from "@/constants/errors";
import type { UseDictationStateReturn } from "@/hooks/useDictationState";
import { AudioProcessor } from "@/services/AudioProcessor";
import { transcribeAudio } from "@/services/transcribeAudio";
import { audioActions, RecordingState } from "@/store/audio";
import { AnalyticsEvents, track } from "@/utils/analytics";
import logger from "@/utils/logger";

export type ConfirmResult = {
  transcript: string;
  detectedLang: string;
} | null;

/**
 * useTranscriptionPipeline — Extracted async transcription pipeline.
 * Handles audio processing, transcription API call, cleanup, and state updates.
 */
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
      let processedUri: string | null = null;

      try {
        logger.info("[VoiceDictation] Confirming dictation, uri:", uri);

        const processResult = await AudioProcessor.processRecording(
          uri,
          capturedDurationRef.current,
          capturedMeteringRef.current,
        );

        if (!processResult.ok) {
          const msg =
            ErrorMessages[processResult.error] ?? "Audio processing failed.";
          logger.error(
            "[VoiceDictation] processRecording failed:",
            processResult.error,
          );
          setError(msg);
          setStatus("error");
          return null;
        }

        processedUri = processResult.value.uri;

        const controller = new AbortController();
        abortControllerRef.current = controller;

        logger.info("[VoiceDictation] Transcribing with lang:", sourceLang);
        const transcribeResult = await transcribeAudio(
          processResult.value,
          sourceLang,
          controller.signal,
        );

        abortControllerRef.current = null;

        if (!transcribeResult.ok) {
          if (controller.signal.aborted) {
            logger.info("[VoiceDictation] Transcription aborted");
            return null;
          }
          const msg =
            ErrorMessages[transcribeResult.error] ?? "Transcription failed.";
          logger.error(
            "[VoiceDictation] Transcription failed:",
            transcribeResult.error,
          );
          setError(msg);
          setStatus("error");
          audioActions.setError(transcribeResult.error as EkweError);
          track(AnalyticsEvents.TRANSCRIPTION_FAILED, {
            sourceLang: sourceLangRef.current,
            durationMs: capturedDurationRef.current,
            error: EkweError.TRANSCRIPTION_FAIL,
          });
          return null;
        }

        const { transcript, detectedLang } = transcribeResult.value;
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
        setNativeWaveform([]);
        capturedNativeWaveformRef.current = [];
        capturedUriRef.current = null;
        return { transcript, detectedLang };
      } catch (err) {
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
        const deletions: Promise<void>[] = [
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}),
        ];
        if (processedUri && processedUri !== uri) {
          deletions.push(
            FileSystem.deleteAsync(processedUri, { idempotent: true }).catch(
              () => {},
            ),
          );
        }
        Promise.all(deletions).then(() =>
          logger.info("[VoiceDictation] Cleaned up temporary audio files"),
        );
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
