import * as Haptics from 'expo-haptics';
import { Mic, X } from 'lucide-react-native';
import React, { useCallback, useMemo } from 'react';
import { View, TextInput, StyleSheet, Pressable, Text } from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedProps,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { LanguageSwitcher } from './LanguageSwitcher';
import { RecordingInline } from './RecordingInline';
import { Divider } from '../ui/Divider';
import { IconButton } from '../ui/IconButton';

import { useTheme, usePermissions } from '@/hooks';
import type { DictationStatus } from '@/hooks/useVoiceDictation';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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

  // Dictation props for inline UI
  dictationStatus: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  maxDurationMs: number;
  onStop: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  capturedUri: string | null;
}

export const ExpressiveInput = React.memo(
  ({
    value,
    onChangeText,
    onClear,
    onMicPress,
    onTranslate,
    isTranslating,
    sourceLang,
    targetLang,
    onSwap,
    onSourceChange,
    onTargetChange,
    dictationStatus,
    amplitude,
    elapsedMs,
    maxDurationMs,
    onStop,
    onCancel,
    onConfirm,
    capturedUri,
  }: ExpressiveInputProps): React.ReactElement => {
    const { color } = useTheme();
    const permissions = usePermissions();
    const maxChars = permissions.textTranslationMaxChars;

    const isRecording = dictationStatus === 'recording';
    const isProcessing = dictationStatus === 'processing';
    const isPreview = dictationStatus === 'preview';
    const isActive = isRecording || isProcessing || isPreview;

    const progress =
      maxDurationMs > 0 ? Math.min(elapsedMs / maxDurationMs, 1) : 0;
    const radius = 38;
    const strokeWidth = 4;
    const circumference = 2 * Math.PI * radius;

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: circumference - progress * circumference,
    }));

    const containerStyle = useMemo(
      () => [styles.container, { backgroundColor: color.card }],
      [color.card],
    );

    const inputStyle = useMemo(
      () => [styles.input, { color: color.foreground }],
      [color.foreground],
    );

    const charCountStyle = useMemo(
      () => [
        styles.charCount,
        { color: value.length >= maxChars ? color.error : color.muted },
      ],
      [value.length, maxChars, color.error, color.muted],
    );

    const handleClear = useCallback(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClear();
    }, [onClear]);

    const micBtnStyle = useCallback(
      ({ pressed }: { pressed: boolean }) => [
        styles.micBtn,
        value.length > 0 && styles.translateBtnActive,
        {
          backgroundColor: isActive
            ? color.error
            : value.length > 0
              ? color.primary
              : color.secondary,
        },
        pressed && !isActive && { transform: [{ scale: 0.95 }] },
        (isTranslating || isActive) && { opacity: 0.7 },
      ],
      [value.length, isActive, color, isTranslating],
    );

    return (
      <View style={containerStyle}>
        <View style={styles.header}>
          <LanguageSwitcher
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSwap={onSwap}
            onSourceChange={onSourceChange}
            onTargetChange={onTargetChange}
          />
        </View>
        <Divider style={styles.divider} />

        {isActive ? (
          <View style={styles.recordingWrapper}>
            <RecordingInline
              status={dictationStatus}
              amplitude={amplitude}
              elapsedMs={elapsedMs}
              maxDurationMs={maxDurationMs}
              onStop={onStop}
              onCancel={onCancel}
              onConfirm={onConfirm}
              capturedUri={capturedUri}
            />
          </View>
        ) : (
          <>
            <TextInput
              style={inputStyle}
              placeholder="Start typing..."
              placeholderTextColor={color.muted}
              value={value}
              onChangeText={onChangeText}
              multiline
              textAlignVertical="top"
              selectionColor={color.secondary}
              maxLength={maxChars}
            />
            <View style={styles.charCountContainer}>
              <Text style={charCountStyle}>
                {value.length}/{maxChars}
              </Text>
            </View>
          </>
        )}

        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            {value.length > 0 ? (
              <View style={styles.footerAction}>
                <IconButton
                  accessibilityLabel="Clear text"
                  onPress={handleClear}
                  backgroundColor={color.surface}
                  size={56}
                  icon={<X size={24} color={color.muted} strokeWidth={2.5} />}
                />
                <Text style={[styles.actionLabel, { color: color.muted }]}>
                  Clear
                </Text>
              </View>
            ) : (
              <View style={styles.footerActionPlaceholder} />
            )}
          </View>

          <View style={styles.micContainer}>
            {isActive && (
              <View style={StyleSheet.absoluteFill}>
                <Svg width={84} height={84} viewBox="0 0 84 84">
                  <Circle
                    cx="42"
                    cy="42"
                    r={radius}
                    stroke="rgba(239, 68, 68, 0.2)"
                    strokeWidth={strokeWidth}
                    fill="none"
                  />
                  <AnimatedCircle
                    cx="42"
                    cy="42"
                    r={radius}
                    stroke="#EF4444"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circumference}
                    animatedProps={animatedProps}
                    transform="rotate(-90 42 42)"
                  />
                </Svg>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isActive
                  ? 'Recording in progress'
                  : value.length > 0
                    ? 'Translate text'
                    : 'Start voice dictation'
              }
              style={micBtnStyle}
              onPress={
                isActive
                  ? undefined
                  : value.length > 0
                    ? onTranslate
                    : onMicPress
              }
              disabled={isTranslating || isActive}
            >
              {isActive ? (
                <Mic size={28} color={color.onSecondary} strokeWidth={2.5} />
              ) : value.length > 0 ? (
                <Text
                  style={[styles.translateText, { color: color.onPrimary }]}
                >
                  {isTranslating ? 'Translating...' : 'Translate'}
                </Text>
              ) : (
                <Mic size={28} color={color.onSecondary} strokeWidth={2.5} />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 36,
    minHeight: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.04,
    shadowRadius: 24,
    elevation: 4,
  },
  header: {
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 16,
  },
  divider: { marginVertical: 0, marginHorizontal: 28, marginBottom: 20 },
  recordingWrapper: {
    flex: 1,
    minHeight: 140,
    justifyContent: 'center',
  },
  input: {
    fontFamily: 'Outfit-Bold',
    fontSize: 36,
    lineHeight: 44,
    flex: 1,
    minHeight: 140,
    paddingHorizontal: 28,
  },
  charCountContainer: {
    paddingHorizontal: 28,
    alignItems: 'flex-end',
    marginTop: 4,
  },
  charCount: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  footerLeft: { flexDirection: 'row', gap: 12 },
  footerAction: { alignItems: 'center', gap: 6 },
  actionLabel: {
    fontFamily: 'Outfit-Medium',
    fontSize: 11,
  },
  footerActionPlaceholder: { width: 56, height: 56 },
  micContainer: {
    minWidth: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  translateBtnActive: {
    width: 'auto',
    paddingHorizontal: 32,
  },
  translateText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 20,
    letterSpacing: 0.5,
  },
});
