import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { DimensionValue, Dimensions, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";

import { Box } from "@/components/ui";
import { borderRadius as borderRadiusToken } from "@/constants/sizes";
import { useTheme } from "@/hooks/ui";
import { withAlpha } from "@/utils/color";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);
const { width: SCREEN_WIDTH } = Dimensions.get("window");

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

  const safeBaseColor = baseColor || withAlpha(color.foreground, 0.071);
  const safeHighlightColor =
    highlightColor || withAlpha(color.foreground, 0.145);

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
    const translateX = interpolate(
      shimmerProgress.value,
      [0, 1],
      [-SCREEN_WIDTH, SCREEN_WIDTH],
    );
    return {
      transform: [{ translateX }, { skewX: "-10deg" }],
    };
  });

  return (
    <Box
      accessible={false}
      accessibilityRole="progressbar"
      style={[
        {
          width,
          height,
          borderRadius: borderRadiusProp,
          overflow: "hidden",
          backgroundColor: safeBaseColor,
        },
        style,
      ]}
    >
      <AnimatedLinearGradient
        colors={["transparent", safeHighlightColor, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[
          StyleSheet.absoluteFill,
          { width: SCREEN_WIDTH },
          animatedStyle,
        ]}
      />
    </Box>
  );
}
