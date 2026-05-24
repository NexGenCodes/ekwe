import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import { PLAN_LIMITS } from '@/constants/billing';
import { EkweError } from '@/constants/errors';
import { translationSchema } from '@/schemas/translation';
import { HistoryService } from '@/services/HistoryService';
import { TranslationService, TranslationResult } from '@/services/Translation';
import { supabase } from '@/services/supabase';
import { history$, audioActions, settings$, auth$ } from '@/store';
import { AppToast } from '@/utils';
import { Result, ok, err } from '@/types/Result';
import { logger } from '@/utils';

export interface UseTranslationReturn {
  translate: (
    transcript: string,
    sourceLang: string,
    targetLang: string,
    signal?: AbortSignal,
  ) => Promise<Result<TranslationResult, EkweError>>;
  isTranslating: boolean;
  translation: string | null;
  transliteration: string | null;

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
  canTranslate: boolean;
}

export const useTranslation = (): UseTranslationReturn => {
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const userSession = useSelector(() => auth$.session.get());

  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [transliteration, setTransliteration] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState('');

  // Free users cannot use auto-detect — default to their first selected language
  const isPro = useSelector(() => auth$.isPro.get());
  const canUseAuto = isPro
    ? PLAN_LIMITS.pro.autoLanguageDetect
    : PLAN_LIMITS.free.autoLanguageDetect;
  const defaultSelectedLangs =
    useSelector(() => settings$.selectedLanguages.get()) || [];
  const defaultSourceLang = canUseAuto
    ? 'auto'
    : defaultSelectedLangs[0] || 'en';

  const initialSourceLang = defaultSourceLang;
  const initialTargetLang =
    (defaultTargetLang || 'es') === initialSourceLang &&
      initialSourceLang !== 'auto'
      ? ''
      : defaultTargetLang || 'es';

  const [sourceLang, setSourceLang] = useState<string>(initialSourceLang);
  const [targetLang, setTargetLang] = useState<string>(initialTargetLang);

  // Sync auth state changes (if they load in slightly after mount) so Pro users always get Auto-Detect by default
  useEffect(() => {
    if (canUseAuto && sourceLang !== 'auto') {
      setSourceLang('auto');
    }
  }, [canUseAuto]); // Intentional: We only want to push them to auto if their permission state changes to true

  const { setError } = audioActions;
  const translationAbortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<string | null>(null);

  const translate = useCallback(
    async (
      transcript: string,
      sourceLang: string,
      targetLang: string,
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
    lastRequestRef.current = null;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSourceText('');
    setTranslation(null);
    setTransliteration(null);
    setIsTranslating(false);
  }, []);

  const handleSwap = useCallback(async () => {
    if (sourceLang === 'auto' || targetLang === 'none' || targetLang === '')
      return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    lastRequestRef.current = null;

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
    async (textOverride?: string) => {
      const textToTranslate = (
        typeof textOverride === 'string' ? textOverride : sourceText
      ).trim();
      if (!textToTranslate) return;

      const requestSignature = `${textToTranslate}|${sourceLang}|${targetLang}`;

      const validation = translationSchema.safeParse({
        text: textToTranslate,
        sourceLang,
        targetLang,
      });

      if (!validation.success) {
        AppToast.error((validation.error.issues?.[0]?.message) ?? 'Please check your input.');
        return;
      }

      Keyboard.dismiss();

      translationAbortRef.current?.abort();
      const controller = new AbortController();
      translationAbortRef.current = controller;

      if (lastRequestRef.current === requestSignature && translation) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      setIsTranslating(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const result = await translate(
          textToTranslate,
          sourceLang,
          targetLang,
          controller.signal,
        );

        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error);

        lastRequestRef.current = requestSignature;

        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );

        // Look up a pending history entry (dictation that saved transcript but no translation yet)
        const allHistory = history$.get();
        const pendingId = Object.keys(allHistory)
          .filter(
            (id) =>
              allHistory[id].transcript === textToTranslate &&
              allHistory[id].translation === null,
          )
          .sort(
            (a, b) => allHistory[b].timestamp - allHistory[a].timestamp,
          )[0];

        if (pendingId) {
          // Update existing entry with translation
          history$[pendingId].translation.set(result.value.translation);
          history$[pendingId].transliteration.set(
            result.value.transliteration ?? null,
          );
          history$[pendingId].targetLang.set(targetLang);

          supabase
            .from('history')
            .update({
              translation_text: result.value.translation,
              transliteration_text: result.value.transliteration ?? null,
              target_lang: targetLang,
            })
            .eq('id', pendingId)
            .then((res) => {
              if (res.error) logger.error(res.error);
            });
        } else {
          // No pending entry — create a new one (text input flow)
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
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        AppToast.error('Translation Failed', {
          description: 'Something went wrong. Please try again.',
        });
      } finally {
        if (!translationAbortRef.current?.signal.aborted) {
          setIsTranslating(false);
        }
      }
    },
    [sourceText, sourceLang, targetLang, userSession, translate],
  );

  const canTranslate = sourceText.trim().length > 0;

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
    canTranslate,
  };
};
