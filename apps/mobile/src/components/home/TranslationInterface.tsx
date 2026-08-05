import { Image as ExpoImage } from "expo-image";
import Languages from "lucide-react-native/icons/languages";
import React, {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

import { ExpressiveInput } from "./ExpressiveInput";
import { ExpressiveOutput } from "./ExpressiveOutput";
import { EmptyState } from "../EmptyState";
import { IconContainer } from "../IconContainer";

import { useSelector } from "@legendapp/state/react";

import { duration, spacing } from "@/constants";
import { iconSize } from "@/constants/sizes";
import {
  useTheme,
  useTranslation,
  useClipboard,
  useVoiceDictation,
} from "@/hooks";
import { isIOS, logger } from "@/utils";
import { AppAlert } from "@/utils/alert";
import { auth$ } from "@/store/auth";
import { settings$ } from "@/store/settings";

export interface TranslationInterfaceProps {
  onInputFocusChange?: (focused: boolean) => void;
}

export interface TranslationInterfaceRef {
  clear: () => Promise<void>;
}

export const TranslationInterface = forwardRef<
  TranslationInterfaceRef,
  TranslationInterfaceProps
>(({ onInputFocusChange }, ref): React.ReactElement => {
  const { color } = useTheme();

  const {
    sourceText,
    setSourceText,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    translation,
    setTranslation,
    transliteration,
    setTransliteration,
    detectedLanguage,
    isTranslating,
    handleTranslate,
    handleClear,
    handleSwap,
  } = useTranslation();

  const { copied, copy } = useClipboard();

  const {
    status: dictationStatus,
    amplitude,
    elapsedMs,
    maxDurationMs,
    error: dictationError,
    capturedUri,
    meteringData,
    interimText,
    finalText,
    isLive,
    startDictation,
    stopDictation,
    confirmDictation,
    cancelDictation,
  } = useVoiceDictation();

  const isPro = useSelector(() => auth$.isPro.get());
  const liveTranscriptionEnabled = useSelector(() =>
    settings$.liveTranscriptionEnabled.get(),
  );
  const isLivePro = isPro && liveTranscriptionEnabled;

  const dictatingRef = useRef(false);

  const handleDictate = useCallback(async (): Promise<void> => {
    if (dictatingRef.current) return;
    dictatingRef.current = true;
    try {
      await handleClear();
      await startDictation(sourceLang, isLivePro);
    } catch (err) {
      logger.error("[Dictation] handleDictate error:", err);
    } finally {
      dictatingRef.current = false;
    }
  }, [startDictation, sourceLang, handleClear, isLivePro]);

  useEffect(() => {
    if (dictationError) {
      AppAlert.error("Voice Input", dictationError);
    }
  }, [dictationError]);

  const handleInputChange = useCallback(
    (t: string) => {
      if (t.length === 0) {
        handleClear();
      } else {
        setSourceText(t);
        setTranslation(null);
      }
    },
    [setSourceText, setTranslation, handleClear],
  );

  const handleConfirmDictation = useCallback(async () => {
    const transcript = await confirmDictation(sourceLang);
    if (transcript) {
      setSourceText(transcript);
      setTranslation(null);
      setTransliteration(null);
    }
  }, [
    confirmDictation,
    sourceLang,
    setSourceText,
    setTranslation,
    setTransliteration,
  ]);

  const handleSourceChange = useCallback(
    (lang: string) => {
      setSourceLang(lang);
      setTranslation(null);
      setTransliteration(null);
    },
    [setSourceLang, setTranslation, setTransliteration],
  );

  const handleTargetChange = useCallback(
    (lang: string) => {
      setTargetLang(lang);
      setTranslation(null);
      setTransliteration(null);
    },
    [setTargetLang, setTranslation, setTransliteration],
  );

  const handleCopy = useCallback(async () => {
    if (translation) {
      await copy(translation);
    }
  }, [translation, copy]);

  useImperativeHandle(ref, () => ({
    clear: handleClear,
  }));

  return (
    <Animated.View
      layout={LinearTransition.springify()}
      style={{
        paddingHorizontal: spacing.md,
        gap: spacing.md,
        marginBottom: spacing["7xl"],
      }}
    >
      <ExpressiveInput
        value={sourceText}
        onChangeText={handleInputChange}
        onClear={handleClear}
        onMicPress={handleDictate}
        onTranslate={handleTranslate}
        isTranslating={isTranslating}
        dictationState={{
          status: dictationStatus,
          amplitude,
          elapsedMs,
          maxDurationMs,
          onStop: stopDictation,
          onConfirm: handleConfirmDictation,
          onCancel: cancelDictation,
          capturedUri,
          meteringData,
          interimText,
          finalText,
          isLive,
        }}
        sourceLang={sourceLang}
        targetLang={targetLang}
        detectedLanguage={detectedLanguage}
        onSwap={handleSwap}
        onSourceChange={handleSourceChange}
        onTargetChange={handleTargetChange}
        onFocus={() => onInputFocusChange?.(true)}
        onBlur={() => onInputFocusChange?.(false)}
      />

      {translation || isTranslating ? (
        <Animated.View
          entering={FadeIn.duration(duration.fast)}
          layout={LinearTransition.springify()}
        >
          <ExpressiveOutput
            translation={translation}
            transliteration={transliteration}
            isTranslating={isTranslating}
            copied={copied}
            onCopy={handleCopy}
            targetLang={targetLang}
          />
        </Animated.View>
      ) : (
        <Animated.View
          entering={FadeIn.duration(duration.fast)}
          layout={LinearTransition.springify()}
        >
          <EmptyState
            icon={
              <IconContainer
                size="xl"
                variant="custom"
                backgroundColor={color.surface}
                style={{ marginBottom: spacing.sm }}
              >
                {isIOS ? (
                  <ExpoImage
                    source="sf:character.bubble.fill"
                    style={{ width: iconSize.lg, height: iconSize.lg }}
                    tintColor={color.muted}
                  />
                ) : (
                  <Languages size={32} color={color.muted} strokeWidth={2} />
                )}
              </IconContainer>
            }
            title="Ready to Translate"
            subtitle="Type or dictate to get started"
          />
        </Animated.View>
      )}
    </Animated.View>
  );
});
