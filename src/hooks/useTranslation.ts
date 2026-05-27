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
import { history$, audioActions, settings$, auth$, audio$ } from '@/store';
import { Result, ok, err } from '@/types/Result';
import { AppToast, logger } from '@/utils';

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

  // Transaction state refs
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);
  const userSessionRef = useRef(userSession);

  useEffect(() => {
    sourceLangRef.current = sourceLang;
    targetLangRef.current = targetLang;
    userSessionRef.current = userSession;
  }, [sourceLang, targetLang, userSession]);

  // Defer save helper for transcription-only
  const saveTranscriptionOnly = useCallback(() => {
    const currentTranscript = audio$.transcriptBuffer.get();
    const duration = audio$.duration.get() || 0;
    const currentSessionId = audio$.sessionId.get();
    const isSaved = audio$.isSaved.get();

    if (
      !isSaved &&
      currentTranscript.trim() &&
      duration > 0 &&
      currentSessionId !== null
    ) {
      audioActions.setSaved(true);
      const detectedSource = audio$.sourceLang.get() || 'en';
      const resolvedSource =
        sourceLangRef.current === 'auto'
          ? detectedSource
          : sourceLangRef.current;

      HistoryService.recordTranslation(
        {
          sourceLang: resolvedSource,
          targetLang: targetLangRef.current || 'en',
          transcript: currentTranscript,
          translation: null,
          transliteration: null,
          duration,
          sourceApp: 'ekwe',
          provider: 'gemini',
          sessionKey: currentSessionId,
        },
        userSessionRef.current,
      ).catch((e) => logger.error('Failed to save transcription-only', e));
    }
  }, []);

  // Save on unmount
  useEffect(() => {
    return (): void => {
      saveTranscriptionOnly();
    };
  }, [saveTranscriptionOnly]);

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
    saveTranscriptionOnly();
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    lastRequestRef.current = null;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSourceText('');
    setTranslation(null);
    setTransliteration(null);
    setIsTranslating(false);
    audioActions.resetAudioState();
  }, [saveTranscriptionOnly]);

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
        AppToast.error(
          validation.error.issues?.[0]?.message ?? 'Please check your input.',
        );
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

        const duration = audio$.duration.get() || 0;
        const currentSessionId = audio$.sessionId.get();

        if (currentSessionId !== null && duration > 0) {
          // Voice note translation (Full Transaction)
          audioActions.setSaved(true);
          await HistoryService.recordTranslation(
            {
              sourceLang:
                sourceLang === 'auto'
                  ? audio$.sourceLang.get() || 'en'
                  : sourceLang,
              targetLang,
              transcript: textToTranslate,
              translation: result.value.translation,
              transliteration: result.value.transliteration || null,
              duration,
              sourceApp: 'ekwe',
              provider: 'gemini',
              sessionKey: currentSessionId,
            },
            userSession,
          );
        } else {
          // Pure text translation (Half Transaction)
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
    [sourceText, sourceLang, targetLang, userSession, translate, translation],
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
