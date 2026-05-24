import * as Haptics from 'expo-haptics';
import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Keyboard,
  Platform,
} from 'react-native';
import {
  SharedValue,
} from 'react-native-reanimated';
import { LanguageSwitcher } from './LanguageSwitcher';
import { RecordingInline } from './RecordingInline';
import { MainTextInput } from './MainTextInput';
import { InputFooterActions } from './InputFooterActions';
import { Divider } from '../ui/Divider';

import { borderRadius, spacing } from '@/constants/designTokens';
import { useTheme, usePermissions } from '@/hooks';
import { AppAlert, AppToast } from '@/utils';
import type { DictationStatus } from '@/hooks/useVoiceDictation';

interface ExpressiveInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  onMicPress: () => void;
  onTranslate: () => void;
  isTranslating?: boolean;
  sourceLang: string;
  targetLang: string;
  onSwap: () => void;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;

  dictationState: {
    status: DictationStatus;
    amplitude: SharedValue<number>;
    elapsedMs: number;
    maxDurationMs: number;
    onStop: () => void;
    onCancel: () => void;
    onConfirm: () => void;
    capturedUri: string | null;
    meteringData?: number[];
  };
  canTranslate?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const ExpressiveInput = React.memo(
  ({
    value,
    onChangeText,
    onClear,
    onMicPress,
    onTranslate,
    isTranslating = false,
    sourceLang,
    targetLang,
    onSwap,
    onSourceChange,
    onTargetChange,
    dictationState,
    canTranslate = true,
    onFocus,
    onBlur,
  }: ExpressiveInputProps): React.ReactElement => {
    const { color } = useTheme();
    const permissions = usePermissions();
    const maxChars = permissions.textTranslationMaxChars;

    const {
      status: dictationStatus,
      amplitude,
      elapsedMs,
      maxDurationMs,
      onStop,
      onCancel,
      onConfirm,
      capturedUri,
      meteringData = [],
    } = dictationState;

    const isInitializing = dictationStatus === 'initializing';
    const isRecording = dictationStatus === 'recording';
    const isProcessing = dictationStatus === 'processing';
    const isPreview = dictationStatus === 'preview';
    const isActive = isRecording || isProcessing || isPreview;

    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

    useEffect(() => {
      const showEvent =
        Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent =
        Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

      const showSub = Keyboard.addListener(showEvent, (): void =>
        setIsKeyboardVisible(true),
      );
      const hideSub = Keyboard.addListener(hideEvent, (): void =>
        setIsKeyboardVisible(false),
      );

      return (): void => {
        showSub.remove();
        hideSub.remove();
      };
    }, []);

    const handleCancelPress = useCallback(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onCancel();
    }, [onCancel]);

    const progress =
      maxDurationMs > 0 ? Math.min(elapsedMs / maxDurationMs, 1) : 0;

    const handleClear = useCallback(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClear();
    }, [onClear]);

    const handleRightButtonPress = useCallback(async () => {
      if (isRecording) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onStop();
      } else if (isPreview) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onConfirm();
      } else if (value.length > 0) {
        const isTargetLangValid = targetLang !== 'none' && targetLang !== '';
        if (!isTargetLangValid) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          AppToast.error('Target Language Required', {
            description: 'Please select a language to translate into.',
            duration: 3000,
          });
          return;
        }
        if (!canTranslate) return; // e.g., source text too short
        onTranslate();
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onMicPress();
      }
    }, [
      isRecording,
      isPreview,
      value.length,
      onStop,
      onConfirm,
      onTranslate,
      onMicPress,
    ]);

    const isTargetLangValid = targetLang !== 'none' && targetLang !== '';
    const isGlobalDisabled = isTranslating || isProcessing || isInitializing;

    // If there is text, the button is "Translate" and needs a valid targetLang.
    // If there is no text, the button is "Mic" and does NOT need a targetLang.
    const isDisabled =
      value.length > 0
        ? isGlobalDisabled || !canTranslate || !isTargetLangValid
        : isGlobalDisabled;

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: color.card, paddingVertical: spacing[4] },
        ]}
      >
        <View style={styles.headerSwitcherContainer}>
          <LanguageSwitcher
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSwap={onSwap}
            onSourceChange={onSourceChange}
            onTargetChange={onTargetChange}
          />
        </View>

        {isActive ? (
          <View style={styles.recordingWrapper}>
            <RecordingInline
              status={dictationStatus}
              amplitude={amplitude}
              elapsedMs={elapsedMs}
              maxDurationMs={maxDurationMs}
              capturedUri={capturedUri}
              meteringData={meteringData}
            />
          </View>
        ) : (
          <MainTextInput
            value={value}
            onChangeText={onChangeText}
            maxChars={maxChars}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        )}

        <Divider style={styles.footerDivider} />

        <InputFooterActions
          valueLength={value.length}
          isActive={isActive}
          isInitializing={isInitializing}
          isRecording={isRecording}
          isProcessing={isProcessing}
          isPreview={isPreview}
          isTranslating={isTranslating}
          isDisabled={isDisabled}
          canTranslate={canTranslate}
          isKeyboardVisible={isKeyboardVisible}
          progress={progress}
          handleCancelPress={handleCancelPress}
          handleClear={handleClear}
          handleRightButtonPress={handleRightButtonPress}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius['2xl'],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.04,
    shadowRadius: 24,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  headerSwitcherContainer: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    width: '100%',
  },
  headerDivider: {
    marginVertical: 0,
    marginBottom: spacing[2],
  },
  recordingWrapper: {
    flex: 1,
    minHeight: 120,
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  footerDivider: {
    marginVertical: spacing[3],
  },
});
