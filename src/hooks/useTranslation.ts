import { useSelector } from '@legendapp/state/react';
import { useCallback, useState } from 'react';

import { EkweError } from '@/constants/errors';
import { TranslationService, TranslationResult } from '@/services/Translation';
import { audio$, audioActions, history$, historyActions } from '@/store';
import { Result, ok, err } from '@/types/Result';

export interface UseTranslationReturn {
  translate: (
    transcript: string,
    sourceLang: string,
    targetLang: string,
    historyEntryId?: string,
  ) => Promise<Result<TranslationResult, EkweError>>;
  isTranslating: boolean;
  translation: string | null;
}

export const useTranslation = (): UseTranslationReturn => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);

  const { setError } = audioActions;
  const entries = useSelector(() => history$.entries.get());
  const { addEntry, deleteEntry, updateEntry } = historyActions;

  const translate = useCallback(
    async (
      transcript: string,
      sourceLang: string,
      targetLang: string,
      historyEntryId?: string,
    ): Promise<Result<TranslationResult, EkweError>> => {
      setIsTranslating(true);

      const result = await TranslationService.translate(
        transcript,
        sourceLang,
        targetLang,
      );

      setIsTranslating(false);

      if (!result.ok) {
        setError(result.error);
        return err(result.error);
      }

      setTranslation(result.value.translation);

      // Update history entry with translation
      if (historyEntryId !== undefined) {
        const currentEntries = history$.entries.get();
        const existing = currentEntries.find((e) => e.id === historyEntryId);
        if (existing !== undefined) {
          historyActions.updateEntry(historyEntryId, {
            ...existing,
            translation: result.value.translation,
            targetLang,
          });
        }
      }

      return ok(result.value);
    },
    [entries],
  );

  return { translate, isTranslating, translation };
};
