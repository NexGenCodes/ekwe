import { Image as ExpoImage } from "expo-image";
import { Languages } from "lucide-react-native";
import React, {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
} from "react";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

import { ExpressiveInput } from "./ExpressiveInput";
import { ExpressiveOutput } from "./ExpressiveOutput";
import { EmptyState } from "../EmptyState";
import { IconContainer } from "../IconContainer";

import { duration, spacing } from "@/constants";
import { iconSize } from "@/constants/sizes";
import {
  useTheme,
  useTranslation,
  useClipboard,
  useVoiceDictation,
} from "@/hooks";
import { isIOS } from "@/utils";
import { AppAlert } from "@/utils/alert";

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
    startDictation,
    stopDictation,
    confirmDictation,
    cancelDictation,
  } = useVoiceDictation();

  const handleDictate = useCallback(async (): Promise<void> => {
    await handleClear();
    await startDictation(sourceLang);
  }, [startDictation, sourceLang, handleClear]);

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
    elapsedMs,
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
        }}
        sourceLang={sourceLang}
        targetLang={targetLang}
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
