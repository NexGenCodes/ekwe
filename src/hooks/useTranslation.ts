import { useCallback, useState } from 'react';
import { history$ } from '@/store';
import { supabase } from '@/services/supabase';

import { EkweError } from '@/constants/errors';
import { TranslationService, TranslationResult } from '@/services/Translation';
import { audioActions } from '@/store';
import { Result, ok, err } from '@/types/Result';
import { logger } from '@/utils';

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

      // Update history entry with translation in PowerSync
      if (historyEntryId !== undefined) {
        try {
          history$[historyEntryId].translation.set(result.value.translation);
          history$[historyEntryId].targetLang.set(targetLang);

          supabase.from('history').update({
            translation_text: result.value.translation,
            target_lang: targetLang
          }).eq('id', historyEntryId).then((res) => {
            if (res.error) logger.error(res.error);
          });
        } catch (e) {
          logger.error('[Translation] Failed to update history entry in local state', e);
        }
      }

      return ok(result.value);
    },
    [setError],
  );

  return { translate, isTranslating, translation };
};
