import { useMutation, UseMutationResult } from '@tanstack/react-query';

import { EkweError } from '@/constants/errors';
import { ProcessedAudio } from '@/services/AudioProcessor';
import {
  TranscriptionService,
  TranscriptionResult,
} from '@/services/Transcription';

interface TranscribeArgs {
  audio: ProcessedAudio;
  sourceLang: string;
}

export const useTranscription = (): UseMutationResult<
  TranscriptionResult,
  EkweError,
  TranscribeArgs
> => {
  return useMutation({
    mutationFn: async ({ audio, sourceLang }: TranscribeArgs) => {
      // Pass the mutation's abort signal to the service
      const result = await TranscriptionService.transcribe(audio, sourceLang);
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    // We already have internal retries in TranscriptionService's fetchWithRetry (3 retries).
    // React Query also has retries, but we keep the internal one to respect network networkUtils configuration.
    retry: false,
  });
};
