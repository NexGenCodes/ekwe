import { EkweError } from "@/constants/errors";
import { translateText, TranslationResult } from "@/services/translateText";
import { Result } from "@/types/Result";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";
import { useMutation } from "@/hooks/core/useMutation";

interface TranslateVariables {
  text: string;
  sourceLang: string;
  targetLang: string;
  signal?: AbortSignal;
}

export function useTranslateMutation(): {
  mutateAsync: (
    variables: TranslateVariables,
  ) => Promise<Result<TranslationResult, EkweError>>;
  isPending: boolean;
} {
  const mutation = useMutation<
    Result<TranslationResult, EkweError>,
    TranslateVariables
  >(async ({ text, sourceLang, targetLang, signal }) => {
    let attempt = 0;
    let result: Result<TranslationResult, EkweError> | undefined;

    while (true) {
      try {
        result = await translateText(text, sourceLang, targetLang, signal);
        break;
      } catch (e: unknown) {
        if (e instanceof Error && (e.message === "AbortError" || attempt >= 2))
          throw e;
        if (attempt >= 2) throw e;
        attempt++;
      }
    }

    if (result && (result.ok || result.error === EkweError.QUOTA_EXCEEDED)) {
      invalidateUsage();
    }

    return result as Result<TranslationResult, EkweError>;
  });

  return {
    mutateAsync: mutation.mutate,
    isPending: mutation.isLoading,
  };
}
