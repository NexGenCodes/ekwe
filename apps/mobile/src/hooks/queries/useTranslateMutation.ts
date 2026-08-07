import { useMutation } from "@tanstack/react-query";

import { EkweError } from "@/constants/errors";
import { translateText, TranslationResult } from "@/services/translateText";
import { Result } from "@/types/Result";

interface TranslateVariables {
  text: string;
  sourceLang: string;
  targetLang: string;
  signal?: AbortSignal;
}

export function useTranslateMutation(): ReturnType<
  typeof useMutation<
    Result<TranslationResult, EkweError>,
    Error,
    TranslateVariables
  >
> {
  return useMutation<
    Result<TranslationResult, EkweError>,
    Error,
    TranslateVariables
  >({
    mutationFn: async ({ text, sourceLang, targetLang, signal }) => {
      return translateText(text, sourceLang, targetLang, signal);
    },
    mutationKey: ["translate"],
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error.message === "AbortError") return false;
      return failureCount < 2;
    },
  });
}
