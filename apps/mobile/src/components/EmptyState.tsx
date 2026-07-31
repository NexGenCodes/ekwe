import React, { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

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
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  useEffect(() => {
    // Respect OS reduced motion preference
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotionEnabled(enabled);
    });

    if (animate) {
      if (!reduceMotionEnabled) {
        scale.value = withRepeat(
          withSequence(
            withTiming(1.05, {
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
            }),
            withTiming(1, {
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
            }),
          ),
          -1,
          true,
        );
      }
    }
  }, [animate, scale, reduceMotionEnabled]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Combine title and subtitle into a concise label for screen readers
  const accessibilityLabel = subtitle ? `${title}. ${subtitle}` : title;

  return (
    <Box
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: spacing["2xl"],
        paddingHorizontal: spacing.lg,
      }}
    >
      <Animated.View
        // If reduced motion is enabled, don't apply animatedStyle
        style={[
          !reduceMotionEnabled && animate ? animatedStyle : undefined,
          { marginBottom: spacing.md },
        ]}
      >
        {icon}
      </Animated.View>
      <Text
        variant="heading3"
        style={{
          color: color.muted,
          textAlign: "center",
          marginBottom: subtitle ? spacing.sm : 0,
        }}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          variant="bodySmall"
          style={{
            color: color.muted,
            textAlign: "center",
          }}
        >
          {subtitle}
        </Text>
      )}
      {action ? <Box style={{ marginTop: spacing.lg }}>{action}</Box> : null}
    </Box>
  );
};
