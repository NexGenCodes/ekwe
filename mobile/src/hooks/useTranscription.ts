import { useSelector } from "@legendapp/state/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EkweError } from "@/constants/errors";
import { useTranscribeMutation } from "@/hooks/queries/useTranscribeMutation";
import { ProcessedAudio } from "@/services/AudioProcessor";
import { TranscriptionResult } from "@/services/transcribeAudio";
import { audio$, audioActions, settings$, RecordingState } from "@/store";
import { Result, ok, err } from "@/types/Result";

export interface UseTranscriptionReturn {
  transcribe: (
    audio: ProcessedAudio,
    overrideLang?: string,
  ) => Promise<Result<TranscriptionResult, EkweError>>;
  cancelTranscription: () => void;
  isTranscribing: boolean;
  detectedLang: string | null;
  mismatch: { detected: string; suggested: string } | null;
}

export const useTranscription = (): UseTranscriptionReturn => {
  const transcribeMutation = useTranscribeMutation();
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{
    detected: string;
    suggested: string;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const sourceLang = useSelector(() => audio$.sourceLang.get());
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const { setError, appendTranscript, setRecordingState } = audioActions;

  const cancelTranscription = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return (): void => {
      cancelTranscription();
    };
  }, [cancelTranscription]);

  const transcribe = useCallback(
    async (
      audio: ProcessedAudio,
      overrideLang?: string,
    ): Promise<Result<TranscriptionResult, EkweError>> => {
      // Cancel previous if any
      cancelTranscription();

      setMismatch(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const lang = overrideLang ?? sourceLang ?? selectedLanguages[0] ?? "en";

      try {
        const result = await transcribeMutation.mutateAsync({
          audio,
          sourceLang: lang,
          signal: controller.signal,
        });

        // Clear controller if we finished naturally
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }

        if (!result.ok) {
          setError(result.error);
          setRecordingState(RecordingState.Error);
          return err(result.error);
        }

        const { transcript, detectedLang: detected } = result.value;

        setDetectedLang(detected);
        appendTranscript(transcript);
        setRecordingState(RecordingState.Done);

        // Language mismatch detection
        if (detected !== "und" && detected !== lang && detected.length > 0) {
          setMismatch({ detected, suggested: lang });
        }

        return ok(result.value);
      } catch (error: unknown) {
        const errType = error instanceof Error ? error.name : "";
        if (errType === "AbortError") {
          // Silent failure for aborted requests
          return err(EkweError.REQUEST_CANCELLED);
        }
        setError(EkweError.TRANSCRIPTION_FAIL);
        return err(EkweError.TRANSCRIPTION_FAIL);
      }
    },
    [
      sourceLang,
      selectedLanguages,
      cancelTranscription,
      setError,
      setRecordingState,
      appendTranscript,
      transcribeMutation,
    ],
  );

  return {
    transcribe,
    cancelTranscription,
    isTranscribing: transcribeMutation.isPending,
    detectedLang,
    mismatch,
  };
};
