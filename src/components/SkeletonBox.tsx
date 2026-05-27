import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { DimensionValue, Dimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';

import { Box } from '@/components/ui';
import { borderRadius as borderRadiusToken } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface SkeletonBoxProps {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: object;
  baseColor?: string;
  highlightColor?: string;
}

export function SkeletonBox({
  width,
  height,
  borderRadius: borderRadiusProp = borderRadiusToken.lg,
  style,
  baseColor,
  highlightColor,
}: SkeletonBoxProps): React.ReactElement {
  const { color } = useTheme();
  const shimmerProgress = useSharedValue(0);

  // Defaults to a neutral translucent contrast based on the current theme foreground
  const safeBaseColor = baseColor || `${color.foreground}12`;
  const safeHighlightColor = highlightColor || `${color.foreground}25`;

  useEffect(() => {
    shimmerProgress.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.bezier(0.3, 0, 0.7, 1),
      }),
      -1,
      false,
    );
  }, [shimmerProgress]);

  const animatedStyle = useAnimatedStyle(() => {
    // Animating across the entire screen width is significantly more performant 
    // than measuring every single box via onLayout, eliminating layout thrashing.
    const translateX = interpolate(
      shimmerProgress.value,
      [0, 1],
      [-SCREEN_WIDTH, SCREEN_WIDTH],
    );
    return {
      transform: [{ translateX }, { skewX: '-10deg' }],
    };
  });

  return (
    <Box
      accessible
      accessibilityRole="progressbar"
      style={[
        {
          width,
          height,
          borderRadius: borderRadiusProp,
          overflow: 'hidden',
          backgroundColor: safeBaseColor,
        },
        style,
      ]}
    >
      <AnimatedLinearGradient
        colors={['transparent', safeHighlightColor, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[
          StyleSheet.absoluteFillObject,
          { width: SCREEN_WIDTH },
          animatedStyle,
        ]}
      />
    </Box>
  );
}

export function SkeletonHistoryRow(): React.ReactElement {
  return (
    <Box
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        gap: spacing.md,
      }}
    >
      <SkeletonBox width={24} height={24} borderRadius={borderRadiusToken.md} />
      <Box style={{ flex: 1 }}>
        <SkeletonBox width="75%" height={14} borderRadius={6} />
        <Box style={{ height: spacing.sm }} />
        <SkeletonBox width="55%" height={12} borderRadius={6} />
      </Box>
      <SkeletonBox width={50} height={18} borderRadius={borderRadiusToken.md} />
    </Box>
  );
}

export function SkeletonTranslationPreview(): React.ReactElement {
  const { color } = useTheme();
  return (
    <Box
      style={{
        margin: spacing.md,
        padding: spacing.lg,
        borderRadius: borderRadiusToken.xl,
        gap: spacing.md,
        backgroundColor: color.card,
      }}
    >
      <Box
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <SkeletonBox width={100} height={14} borderRadius={6} />
        <SkeletonBox width={70} height={14} borderRadius={6} />
      </Box>
      <Box style={{ paddingVertical: spacing.xs }}>
        <SkeletonBox width="100%" height={12} borderRadius={6} />
        <Box style={{ height: spacing.sm }} />
        <SkeletonBox width="85%" height={12} borderRadius={6} />
        <Box style={{ height: spacing.sm }} />
        <SkeletonBox width="70%" height={12} borderRadius={6} />
      </Box>
      <Box
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: spacing.sm,
        }}
      >
        <SkeletonBox
          width={140}
          height={36}
          borderRadius={borderRadiusToken.xl}
        />
        <SkeletonBox
          width={36}
          height={36}
          borderRadius={borderRadiusToken.xl}
        />
      </Box>
    </Box>
  );
}
