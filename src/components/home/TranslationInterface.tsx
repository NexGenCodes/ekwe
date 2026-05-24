import { Image as ExpoImage } from 'expo-image';
import { Languages } from 'lucide-react-native';
import React, { forwardRef, useImperativeHandle, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { ExpressiveInput } from './ExpressiveInput';
import { ExpressiveOutput } from './ExpressiveOutput';
import { EmptyState } from '../ui/EmptyState';
import { IconContainer } from '../ui/IconContainer';

import {
  useTheme,
  useTranslation,
  useClipboard,
  useVoiceDictation,
} from '@/hooks';
import { HistoryService } from '@/services/HistoryService';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export interface TranslationInterfaceProps {
  onInputFocusChange?: (focused: boolean) => void;
}

export interface TranslationInterfaceRef {
  clear: () => Promise<void>;
}

export const TranslationInterface = forwardRef<TranslationInterfaceRef, TranslationInterfaceProps>(
  ({ onInputFocusChange }, ref): React.ReactElement => {
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
      await startDictation(sourceLang);
    }, [startDictation, sourceLang]);

    useEffect(() => {
      if (dictationError) {
        AppAlert.error('Voice Input', dictationError);
      }
    }, [dictationError]);

    const handleInputChange = useCallback(
      (t: string) => {
        setSourceText(t);
        setTranslation(null);
      },
      [setSourceText, setTranslation],
    );

    const handleConfirmDictation = useCallback(async () => {
      const transcript = await confirmDictation(sourceLang);
      if (transcript) {
        setSourceText(transcript);
        setTranslation(null);
        setTransliteration(null);

        // Save dictation as a history entry immediately (transcript only, no translation yet)
        // When translate runs, handleTranslate will find this entry by matching transcript
        // and update it in-place — no fragile ref passing needed.
        const session = auth$.session.get();
        if (session) {
          HistoryService.recordTranslation(
            {
              sourceLang,
              targetLang,
              transcript,
              translation: null,
              transliteration: null,
              duration: elapsedMs / 1000,
              sourceApp: 'ekwe-home',
              provider: 'whisper',
            },
            session,
          );
        }
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
      <View>
        <Animated.View entering={FadeInDown.delay(200).duration(450)}>
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
        </Animated.View>

        {translation || isTranslating ? (
          <Animated.View
            entering={FadeInUp.duration(300)}
            style={{ marginTop: 24 }}
          >
            <ExpressiveOutput
              translation={translation}
              transliteration={transliteration}
              isTranslating={isTranslating}
              copied={copied}
              onCopy={translation ? handleCopy : undefined}
              targetLang={targetLang}
            />
          </Animated.View>
        ) : (
          <Animated.View
            entering={FadeInUp.delay(300).duration(400)}
            style={{ marginTop: 24 }}
          >
            <EmptyState
              icon={
                <IconContainer
                  size="xl"
                  variant="custom"
                  backgroundColor={color.surface}
                  style={{ marginBottom: 8 }}
                >
                  {process.env.EXPO_OS === 'ios' ? (
                    <ExpoImage
                      source="sf:character.bubble.fill"
                      style={{ width: 32, height: 32 }}
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
      </View>
    );
  },
);
