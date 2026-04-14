import { useMutation, UseMutationResult } from '@tanstack/react-query';

import { EkweError } from '@/constants/errors';
import { TranslationService, TranslationResult } from '@/services/Translation';

interface TranslateArgs {
  text: string;
  sourceLang: string;
  targetLang: string;
}

export const useTranslation = (): UseMutationResult<
  TranslationResult,
  EkweError,
  TranslateArgs
> => {
  return useMutation({
    mutationFn: async ({ text, sourceLang, targetLang }: TranslateArgs) => {
      const result = await TranslationService.translate(
        text,
        sourceLang,
        targetLang,
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    // We already have internal retries in TranslationService's fetchWithRetry (2 retries).
    retry: false,
  });
};
