import { useMutation } from "@tanstack/react-query";

import { EkweError } from "@/constants/errors";
import { ProcessedAudio } from "@/services/AudioProcessor";
import {
  transcribeAudio,
  TranscriptionResult,
} from "@/services/transcribeAudio";
import { Result } from "@/types/Result";

interface TranscribeVariables {
  audio: ProcessedAudio;
  sourceLang: string;
  signal?: AbortSignal;
}

export function useTranscribeMutation(): ReturnType<
  typeof useMutation<
    Result<TranscriptionResult, EkweError>,
    Error,
    TranscribeVariables
  >
> {
  return useMutation<
    Result<TranscriptionResult, EkweError>,
    Error,
    TranscribeVariables
  >({
    mutationFn: async ({ audio, sourceLang, signal }) => {
      return transcribeAudio(audio, sourceLang, signal);
    },
    mutationKey: ["transcribe"],
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error.message === "AbortError") return false;
      return failureCount < 2;
    },
  });
}
