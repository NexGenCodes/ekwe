import { useSelector } from "@legendapp/state/react";
import { translationSchema } from "@ekwe/shared";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { EkweError, ErrorMessages } from "@/constants/errors";
import { useTranslateMutation } from "@/hooks/queries/useTranslateMutation";
import { usePermissions } from "@/hooks/usePermissions";
import { HistoryService } from "@/services/HistoryService";
import { TranslationResult } from "@/services/translateText";
import { audioActions, settings$, auth$, audio$ } from "@/store";
import { Result, ok, err } from "@/types/Result";
import { AppToast } from "@/utils/toast";
import { triggerHaptic } from "@/utils/haptics";
import { default as logger } from "@/utils/logger";
import {
  getDefaultSourceLang,
  resolveDetectedLanguage,
} from "@/utils/languageUtils";

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

  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const userSession = useSelector(() => auth$.session.get());

  const [translation, setTranslation] = useState<string | null>(null);
  const [transliteration, setTransliteration] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState("");

  const permissions = usePermissions();
  const myLanguages =
    useSelector(() => settings$.selectedLanguages.get()) || [];
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

  // History-entry state refs
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
      const detectedSource = audio$.sourceLang.get() || "en";
      const resolvedSource =
        resolveDetectedLanguage(detectedSource, sourceLangRef.current, "en") ??
        (targetLangRef.current || "en");

      HistoryService.recordTranslation(
        {
          sourceLang: resolvedSource,
          targetLang: targetLangRef.current || "en",
          transcript: currentTranscript,
          translation: null,
          transliteration: null,
          duration,
          sourceApp: "ekwe",
          provider: "gemini",
          sessionKey: currentSessionId,
          type: "transcription",
        },
        userSessionRef.current,
      ).catch((e) => logger.error("Failed to save transcription-only", e));
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

  // Clear request cache when sourceText changes
  useEffect(() => {
    lastRequestRef.current = null;
  }, [sourceText]);

  const handleClear = useCallback(async () => {
    saveTranscriptionOnly();
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    lastRequestRef.current = null;
    await triggerHaptic();
    setSourceText("");
    setTranslation(null);
    setTransliteration(null);
    setDetectedLanguage(null);
    audioActions.resetAudioState();
  }, [saveTranscriptionOnly]);

  const handleSwap = useCallback(async () => {
    if (
      sourceLang === "auto" ||
      targetLang === "none" ||
      targetLang === "" ||
      sourceLang === targetLang
    )
      return;
    // Abort any in-flight translation before swapping languages
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

        const duration = audio$.duration.get() || 0;
        const currentSessionId = audio$.sessionId.get();

        if (currentSessionId !== null && duration > 0) {
          // Voice note transcribed then translated → TWO separate history
          // entries: a transcription (text + audio metadata) and a separate
          // translation. The audio is only ever saved once — skip the
          // transcription if an earlier save already persisted it.
          const resolvedSource =
            resolveDetectedLanguage(
              audio$.sourceLang.get(),
              sourceLang,
              "en",
            ) ?? sourceLang;

          if (!audio$.isSaved.get()) {
            audioActions.setSaved(true);
            await HistoryService.recordTranslation(
              {
                sourceLang: resolvedSource,
                targetLang,
                transcript: textToTranslate,
                translation: null,
                transliteration: null,
                duration,
                sourceApp: "ekwe",
                provider: "gemini",
                sessionKey: currentSessionId,
                type: "transcription",
              },
              userSession,
            );
          }

          // Translation entry — text → text, no audio metadata.
          await HistoryService.recordTranslation(
            {
              sourceLang: resolvedSource,
              targetLang,
              transcript: textToTranslate,
              translation: result.value.translation,
              transliteration: result.value.transliteration || null,
              duration: 0,
              sourceApp: "ekwe",
              provider: "gemini",
              type: "translation",
            },
            userSession,
          );
        } else {
          // Pure text translation (no audio)
          await HistoryService.recordTranslation(
            {
              sourceLang,
              targetLang,
              transcript: textToTranslate,
              translation: result.value.translation,
              transliteration: result.value.transliteration || null,
              duration: 0,
              sourceApp: "ekwe-home",
              provider: "gemini",
              type: "translation",
            },
            userSession,
          );
        }
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
    [sourceText, sourceLang, targetLang, userSession, translate, translation],
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
