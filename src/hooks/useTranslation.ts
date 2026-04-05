import { useCallback, useState } from 'react';
import { EkweError } from 'src/constants/errors';
import { TranslationService } from 'src/services/Translation';
import { useAudioStore, useSettingsStore, useHistoryStore } from 'src/store';
import { Result, ok, err } from 'src/types/Result';

export interface UseTranslationReturn {
  translate: (
    transcript: string,
    sourceLang: string,
    targetLang: string,
    historyEntryId?: string,
  ) => Promise<Result<string, EkweError>>;
  isTranslating: boolean;
  translation: string | null;
}

export const useTranslation = (): UseTranslationReturn => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);

  const setError = useAudioStore((s) => s.setError);
  const entries = useHistoryStore((s) => s.entries);
  const addEntry = useHistoryStore((s) => s.addEntry);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);

  const translate = useCallback(
    async (
      transcript: string,
      sourceLang: string,
      targetLang: string,
      historyEntryId?: string,
    ): Promise<Result<string, EkweError>> => {
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
        const existing = entries.find((e) => e.id === historyEntryId);
        if (existing !== undefined) {
          // Delete old entry and re-add with translation
          deleteEntry(historyEntryId);
          addEntry({
            ...existing,
            translation: result.value.translation,
            targetLang,
          });
        }
      }

      return ok(result.value.translation);
    },
    [setError, entries, addEntry, deleteEntry],
  );

  return { translate, isTranslating, translation };
};
