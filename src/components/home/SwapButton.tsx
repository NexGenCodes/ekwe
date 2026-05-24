import * as Haptics from 'expo-haptics';
import { ArrowRightLeft } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  SharedValue,
} from 'react-native-reanimated';

import { borderRadius, spacing } from '@/constants/designTokens';
import { useTheme } from '@/hooks';
import { AppToast } from '@/utils';

interface SwapButtonProps {
  sourceLang: string;
  targetLang: string;
  onSwap: () => void;
  swapRotation: SharedValue<number>;
}

export function SwapButton({
  sourceLang,
  targetLang,
  onSwap,
  swapRotation,
}: SwapButtonProps): React.ReactElement {
  const { color } = useTheme();

  const isSwapDisabled =
    sourceLang === 'auto' ||
    targetLang === 'auto' ||
    sourceLang === '' ||
    targetLang === '';

  const animatedSwapStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${swapRotation.value}deg` }],
    };
  });

  const handlePress = async (): Promise<void> => {
    if (isSwapDisabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      AppToast.info('Auto detect is only available for source language');
      return;
    }
    swapRotation.value = withTiming(swapRotation.value + 180, {
      duration: 250,
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSwap();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Swap languages"
      onPress={handlePress}
      style={({ pressed }) => [
        styles.swapBtn,
        { backgroundColor: color.primary },
        (pressed || isSwapDisabled) && { opacity: 0.5 },
        pressed && !isSwapDisabled && { transform: [{ scale: 0.9 }] },
      ]}
    >
      <Animated.View style={animatedSwapStyle}>
        <ArrowRightLeft size={16} color={color.onPrimary} strokeWidth={2.5} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  swapBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing[1],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
});
