import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { typography, spacing } from '@/constants/designTokens';
import { useTheme } from '@/hooks';

export interface EmptyStateProps {
  /** Icon element rendered above the title */
  icon?: React.ReactNode;
  /** Primary message */
  title: string;
  /** Secondary description */
  subtitle?: string;
  /** Optional action element (button, link, etc.) below subtitle */
  action?: React.ReactNode;
  /** Enable subtle pulse animation on icon */
  animate?: boolean;
}

/**
 * EmptyState — Centered placeholder for empty lists/screens.
 * Icon + title + subtitle with optional action slot.
 */
export const EmptyState = ({
  icon,
  title,
  subtitle,
  action,
  animate = false,
}: EmptyStateProps): React.ReactElement => {
  const { color } = useTheme();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (animate) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.05, {
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    }
  }, [animate, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing[10],
        paddingHorizontal: spacing[6],
      }}
    >
      <Animated.View
        style={[animate && animatedStyle, { marginBottom: spacing[4] }]}
      >
        {icon}
      </Animated.View>
      <Text
        style={{
          fontSize: typography.heading3.size,
          fontFamily: 'Outfit-Bold',
          color: color.muted,
          textAlign: 'center',
          marginBottom: subtitle ? spacing[2] : 0,
        }}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            fontSize: typography.bodySmall.size,
            fontFamily: 'Outfit-Regular',
            color: color.muted,
            textAlign: 'center',
            lineHeight: typography.bodySmall.lineHeight,
          }}
        >
          {subtitle}
        </Text>
      )}
      {action && <View style={{ marginTop: spacing[5] }}>{action}</View>}
    </View>
  );
};
