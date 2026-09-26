import { useValue } from "@legendapp/state/react";
import { translationSchema } from "@ekwe/shared";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { EkweError, ErrorMessages } from "@/constants/errors";
import { useTranslateMutation } from "@/hooks/queries/useTranslateMutation";
import { usePermissions } from "@/hooks/usePermissions";
import { TranslationResult } from "@/services/translateText";
import { audioActions, settings$ } from "@/store";
import { Result, ok, err } from "@/types/Result";
import { AppToast } from "@/utils/toast";
import { triggerHaptic } from "@/utils/haptics";
import { getDefaultSourceLang } from "@/utils/languageUtils";

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
  detectedLanguage: string | null;

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
  const translateMutation = useTranslateMutation();

  const defaultTargetLang = useValue(() => settings$.targetLanguage.get());

  const [translation, setTranslation] = useState<string | null>(null);
  const [transliteration, setTransliteration] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState("");

  const permissions = usePermissions();
  const myLanguages = useValue(() => settings$.selectedLanguages.get()) || [];
  const defaultSourceLang = getDefaultSourceLang(
    permissions.autoLanguageDetect,
  );
  let initialTargetLang = defaultTargetLang || myLanguages[0] || "es";
  if (defaultSourceLang !== "auto" && defaultSourceLang === initialTargetLang) {
    initialTargetLang =
      myLanguages[1] ||
      myLanguages[0] ||
      (initialTargetLang === "es" ? "it" : "es");
  }

  const [sourceLang, setSourceLang] = useState<string>(defaultSourceLang);
  const [targetLang, setTargetLang] = useState<string>(initialTargetLang);

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
      try {
        const result = await translateMutation.mutateAsync({
          text: transcript,
          sourceLang,
          targetLang,
          signal,
        });

        if (!result.ok) {
          setError(result.error);
          return err(result.error);
        }

        setTranslation(result.value.translation);
        setTransliteration(result.value.transliteration ?? null);
        setDetectedLanguage(result.value.language ?? null);

        return ok(result.value);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          return err(EkweError.NETWORK_LOST);
        }
        setError(EkweError.TRANSLATION_FAIL);
        return err(EkweError.TRANSLATION_FAIL);
      }
    },
    [translateMutation, setError],
  );

  useEffect(() => {
    lastRequestRef.current = null;
  }, [sourceText]);

  const handleClear = useCallback(async () => {
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    lastRequestRef.current = null;
    await triggerHaptic();
    setSourceText("");
    setTranslation(null);
    setTransliteration(null);
    setDetectedLanguage(null);
    audioActions.resetAudioState();
  }, []);

  const handleSwap = useCallback(async () => {
    if (
      sourceLang === "auto" ||
      targetLang === "none" ||
      targetLang === "" ||
      sourceLang === targetLang
    )
      return;

    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    await triggerHaptic();
    lastRequestRef.current = null;

    setSourceLang(targetLang);
    setTargetLang(sourceLang);

    if (translation) {
      const oldSource = sourceText;
      setSourceText(translation);
      setTranslation(oldSource);
    }
  }, [sourceLang, targetLang, translation, sourceText]);

  const handleTranslate = useCallback(
    async (textOverride?: string) => {
      const textToTranslate = (
        typeof textOverride === "string" ? textOverride : sourceText
      ).trim();
      if (!textToTranslate) return;

      if (sourceLang === targetLang) {
        AppToast.info(
          "Source and target languages are the same. Change one to translate.",
        );
        return;
      }

      const requestSignature = `${textToTranslate}|${sourceLang}|${targetLang}`;

      const validation = translationSchema.safeParse({
        text: textToTranslate,
        sourceLang,
        targetLang,
      });

      if (!validation.success) {
        AppToast.error(
          validation.error.issues?.[0]?.message ?? "Please check your input.",
        );
        return;
      }

      Keyboard.dismiss();

      translationAbortRef.current?.abort();
      const controller = new AbortController();
      translationAbortRef.current = controller;

      if (lastRequestRef.current === requestSignature && translation) {
        triggerHaptic(Haptics.NotificationFeedbackType.Success);
        return;
      }

      await triggerHaptic();
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

        await triggerHaptic(Haptics.NotificationFeedbackType.Success);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        const code = e instanceof Error ? (e.message as EkweError) : undefined;
        AppToast.error("Translation Failed", {
          description:
            code && ErrorMessages[code]
              ? ErrorMessages[code]
              : "Something went wrong. Please try again.",
        });
      }
    },
    [sourceText, sourceLang, targetLang, translate, translation],
  );

  const canTranslate =
    sourceText.trim().length > 0 && sourceLang !== targetLang;

  return {
    translate,
    isTranslating: translateMutation.isPending,
    translation,
    transliteration,
    detectedLanguage,
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
