import React, { useMemo } from 'react';
import { View, Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Mic, X, Square, Trash2, Send } from 'lucide-react-native';

import { IconButton } from '../ui/IconButton';
import { spacing, typography } from '@/constants/designTokens';
import { useTheme } from '@/hooks';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface InputFooterActionsProps {
  valueLength: number;
  isActive: boolean;
  isInitializing: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isPreview: boolean;
  isTranslating: boolean;
  isDisabled: boolean;
  canTranslate: boolean;
  isKeyboardVisible: boolean;
  progress: number;
  handleCancelPress: () => void;
  handleClear: () => void;
  handleRightButtonPress: () => void;
}

export const InputFooterActions = React.memo(
  ({
    valueLength,
    isActive,
    isInitializing,
    isRecording,
    isProcessing,
    isPreview,
    isTranslating,
    isDisabled,
    canTranslate,
    isKeyboardVisible,
    progress,
    handleCancelPress,
    handleClear,
    handleRightButtonPress,
  }: InputFooterActionsProps) => {
    const { color } = useTheme();

    const radius = 26;
    const strokeWidth = 3;
    const circumference = 2 * Math.PI * radius;

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: circumference - progress * circumference,
    }));

    const micBtnStyle = useMemo(
      () => ({ pressed }: { pressed: boolean }) => [
        styles.micBtn,
        (valueLength > 0 || isPreview) && styles.translateBtnActive,
        {
          backgroundColor:
            isRecording || isProcessing
              ? color.error
              : isPreview
                ? color.primary
                : valueLength > 0
                  ? canTranslate
                    ? color.primary
                    : color.border
                  : color.secondary,
        },
        pressed &&
        !isProcessing &&
        (isPreview || isRecording || (valueLength > 0 && canTranslate)) && {
          transform: [{ scale: 0.95 }],
        },
        isDisabled && {
          opacity: 0.5,
        },
      ],
      [
        valueLength,
        isRecording,
        isProcessing,
        isPreview,
        color,
        canTranslate,
        isDisabled,
      ],
    );

    return (
      <View style={styles.footer}>
        {isActive ? (
          <View style={styles.actionsRow}>
            <View style={styles.footerLeft}>
              <View style={styles.footerAction}>
                <IconButton
                  accessibilityLabel="Discard recording"
                  onPress={handleCancelPress}
                  backgroundColor={color.surface}
                  size={52}
                  icon={<Trash2 size={22} color="#EF4444" strokeWidth={2} />}
                />
                {!isKeyboardVisible && (
                  <Text style={[styles.actionLabel, { color: '#EF4444' }]}>
                    Cancel
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.micContainer}>
              {(isRecording || isProcessing) && (
                <View style={StyleSheet.absoluteFill}>
                  <Svg width={60} height={60} viewBox="0 0 60 60">
                    <Circle
                      cx="30"
                      cy="30"
                      r={radius}
                      stroke="rgba(239, 68, 68, 0.2)"
                      strokeWidth={strokeWidth}
                      fill="none"
                    />
                    <AnimatedCircle
                      cx="30"
                      cy="30"
                      r={radius}
                      stroke="#EF4444"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={circumference}
                      animatedProps={animatedProps}
                      transform="rotate(-90 30 30)"
                    />
                  </Svg>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isPreview ? 'Confirm audio' : 'Stop recording'
                }
                style={micBtnStyle}
                onPress={handleRightButtonPress}
                disabled={isTranslating || isProcessing || isInitializing}
                hitSlop={15}
              >
                {isRecording ? (
                  <Square
                    size={22}
                    color={color.onSecondary}
                    fill={color.onSecondary}
                    strokeWidth={2.5}
                  />
                ) : isProcessing ? (
                  <ActivityIndicator color={color.onPrimary} size="small" />
                ) : (
                  <Send size={18} color={color.onPrimary} strokeWidth={2.5} />
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.classicFooter}>
            <View style={styles.actionsRow}>
              <View style={styles.footerLeft}>
                {valueLength > 0 ? (
                  <View style={styles.footerAction}>
                    <IconButton
                      accessibilityLabel="Clear text"
                      onPress={handleClear}
                      backgroundColor={color.surface}
                      size={52}
                      icon={
                        <X size={22} color={color.muted} strokeWidth={2.5} />
                      }
                    />
                    <Text
                      style={[styles.actionLabel, { color: color.muted }]}
                    >
                      Clear
                    </Text>
                  </View>
                ) : (
                  <View style={styles.footerActionPlaceholder} />
                )}
              </View>

              <View style={styles.micContainer}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    valueLength > 0
                      ? 'Translate text'
                      : 'Start voice dictation'
                  }
                  style={micBtnStyle}
                  onPress={handleRightButtonPress}
                  disabled={isTranslating || isProcessing || isInitializing}
                  hitSlop={15}
                >
                  {isInitializing ? (
                    <ActivityIndicator color={color.onPrimary} size="small" />
                  ) : valueLength > 0 ? (
                    <View style={styles.translateRow}>
                      <Text
                        style={[
                          styles.translateText,
                          { color: color.onPrimary },
                        ]}
                      >
                        {isTranslating ? 'Translating...' : 'Translate'}
                      </Text>
                      <Send
                        size={18}
                        color={color.onPrimary}
                        strokeWidth={2.5}
                      />
                    </View>
                  ) : (
                    <Mic
                      size={24}
                      color={color.onSecondary}
                      strokeWidth={2.5}
                    />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: spacing[6],
  },
  classicFooter: {
    width: '100%',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    width: '100%',
  },
  footerLeft: { flexDirection: 'row', gap: spacing[3] },
  footerAction: { alignItems: 'center', gap: spacing[1] },
  actionLabel: {
    fontFamily: 'Outfit-Medium',
    fontSize: typography.caption.size - 1,
  },
  footerActionPlaceholder: { width: 52, height: 52 },
  micContainer: {
    minWidth: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  translateBtnActive: {
    width: 'auto',
    paddingHorizontal: spacing[6],
  },
  translateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  translateText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 16,
    letterSpacing: 0.3,
  },
});
