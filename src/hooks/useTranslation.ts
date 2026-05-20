import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import { EkweError } from '@/constants/errors';
import { HistoryService } from '@/services/HistoryService';
import { TranslationService, TranslationResult } from '@/services/Translation';
import { supabase } from '@/services/supabase';
import { history$, audioActions, settings$, auth$ } from '@/store';
import { Result, ok, err } from '@/types/Result';
import { logger } from '@/utils';
import { AppAlert } from '@/utils/alert';

export interface UseTranslationReturn {
  translate: (
    transcript: string,
    sourceLang: string,
    targetLang: string,
    historyEntryId?: string,
    signal?: AbortSignal,
  ) => Promise<Result<TranslationResult, EkweError>>;
  isTranslating: boolean;
  translation: string | null;
  transliteration: string | null;

  // Extended state for UI controllers
  sourceText: string;
  setSourceText: (text: string) => void;
  sourceLang: string;
  setSourceLang: (lang: string) => void;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  setTranslation: (text: string | null) => void;
  setTransliteration: (text: string | null) => void;

  handleTranslate: (textOverride?: string) => Promise<void>;
  handleClear: () => Promise<void>;
  handleSwap: () => Promise<void>;
}

export const useTranslation = (): UseTranslationReturn => {
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const userSession = useSelector(() => auth$.session.get());

  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [transliteration, setTransliteration] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState('');
  const [sourceLang, setSourceLang] = useState<string>('auto');
  const [targetLang, setTargetLang] = useState<string>(
    defaultTargetLang || 'es',
  );

  const { setError } = audioActions;
  const translationAbortRef = useRef<AbortController | null>(null);

  const translate = useCallback(
    async (
      transcript: string,
      sourceLang: string,
      targetLang: string,
      historyEntryId?: string,
      signal?: AbortSignal,
    ): Promise<Result<TranslationResult, EkweError>> => {
      setIsTranslating(true);
      try {
        const result = await TranslationService.translate(
          transcript,
          sourceLang,
          targetLang,
          signal,
        );

        if (!result.ok) {
          setError(result.error);
          return err(result.error);
        }

        setTranslation(result.value.translation);
        setTransliteration(result.value.transliteration ?? null);

        // Update history entry with translation
        if (historyEntryId !== undefined) {
          try {
            history$[historyEntryId].translation.set(result.value.translation);
            history$[historyEntryId].transliteration.set(
              result.value.transliteration ?? null,
            );
            history$[historyEntryId].targetLang.set(targetLang);

            supabase
              .from('history')
              .update({
                translation_text: result.value.translation,
                transliteration_text: result.value.transliteration ?? null,
                target_lang: targetLang,
              })
              .eq('id', historyEntryId)
              .then((res) => {
                if (res.error) logger.error(res.error);
              });
          } catch (e) {
            logger.error(
              '[Translation] Failed to update history entry in local state',
              e,
            );
          }
        }

        return ok(result.value);
      } finally {
        setIsTranslating(false);
      }
    },
    [setError],
  );

  const handleClear = useCallback(async () => {
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSourceText('');
    setTranslation(null);
    setTransliteration(null);
    setIsTranslating(false);
  }, []);

  const handleSwap = useCallback(async () => {
    if (sourceLang === 'auto') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setSourceLang(targetLang);
    setTargetLang(sourceLang);

    if (translation) {
      const oldSource = sourceText;
      setSourceText(translation);
      setTranslation(oldSource);
    } else {
      setSourceText('');
      setTranslation(null);
    }
  }, [sourceLang, targetLang, translation, sourceText]);

  const handleTranslate = useCallback(
    async (textOverride?: string | any) => {
      const textToTranslate = (
        typeof textOverride === 'string' ? textOverride : sourceText
      ).trim();
      if (!textToTranslate) return;
      Keyboard.dismiss();

      translationAbortRef.current?.abort();
      const controller = new AbortController();
      translationAbortRef.current = controller;

      setIsTranslating(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const result = await translate(
          textToTranslate,
          sourceLang,
          targetLang,
          undefined,
          controller.signal,
        );

        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error);

        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );

        await HistoryService.recordTranslation(
          {
            sourceLang,
            targetLang,
            transcript: textToTranslate,
            translation: result.value.translation,
            transliteration: result.value.transliteration || null,
            duration: 0,
            sourceApp: 'ekwe-home',
            provider: 'gemini',
          },
          userSession,
        );
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        AppAlert.error('Translation Failed', 'Please try again.');
      } finally {
        if (!translationAbortRef.current?.signal.aborted) {
          setIsTranslating(false);
        }
      }
    },
    [sourceText, sourceLang, targetLang, userSession, translate],
  );

  return {
    translate,
    isTranslating,
    translation,
    transliteration,
    sourceText,
    setSourceText,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    setTranslation,
    setTransliteration,
    handleTranslate,
    handleClear,
    handleSwap,
  };
};
