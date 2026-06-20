import { triggerHaptic } from "@/utils/haptics";
import { Loader } from "lucide-react-native";
import React, { useMemo } from "react";
import { StyleProp, TextStyle, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Box, Pressable, Text } from "@/components/ui";
import {
  borderRadius,
  opacity,
  interaction,
  spinnerSize,
} from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";

type ButtonVariant = "primary" | "outline" | "ghost";
type ButtonSize = "small" | "medium" | "large" | "md";

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const Button = React.memo(function Button({
  label,
  variant = "primary",
  size = "medium",
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  onPress,
  style,
  labelStyle,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps): React.ReactElement {
  const { color } = useTheme();

  // Reanimated shared values
  const scaleAnim = useSharedValue(1);
  const spinAnim = useSharedValue(0);

  React.useEffect(() => {
    if (loading) {
      spinAnim.value = withRepeat(
        withTiming(360, {
          duration: 1000,
          easing: Easing.linear,
        }),
        -1, // infinite
        false, // no reverse
      );
    } else {
      spinAnim.value = 0;
    }
  }, [loading, spinAnim]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinAnim.value}deg` }],
  }));

  const handlePressIn = (): void => {
    if (disabled || loading) return;
    scaleAnim.value = withTiming(0.95, { duration: 100 });
    triggerHaptic();
  };

  const handlePressOut = (): void => {
    scaleAnim.value = withTiming(1, { duration: 150 });
  };

  const { variantStyle, sizeStyle } = useMemo(() => {
    let vStyle = { container: {}, text: {}, spinner: color.brand };
    switch (variant) {
      case "primary":
        vStyle = {
          container: { backgroundColor: color.brand },
          text: { color: color.onBrand },
          spinner: color.onBrand,
        };
        break;
      case "outline":
        vStyle = {
          container: {
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor: color.brand,
          },
          text: { color: color.brand },
          spinner: color.brand,
        };
        break;
      case "ghost":
        vStyle = {
          container: { backgroundColor: "transparent" },
          text: { color: color.brand },
          spinner: color.brand,
        };
        break;
    }

    let sStyle = { container: {}, text: {} };
    switch (size) {
      case "small":
        sStyle = {
          container: {
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            minHeight: 48,
          },
          text: { fontFamily: typography.label.fontFamily },
        };
        break;
      case "large":
        sStyle = {
          container: {
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            minHeight: 56,
          },
          text: {
            fontFamily: typography.heading3.fontFamily,
            lineHeight: 24,
            letterSpacing: -0.2,
          },
        };
        break;
      case "medium":
      case "md":
      default:
        sStyle = {
          container: {
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            minHeight: 48,
          },
          text: { fontFamily: typography.label.fontFamily },
        };
        break;
    }

    return { variantStyle: vStyle, sizeStyle: sStyle };
  }, [variant, size, color]);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: borderRadius.xl,
          opacity: disabled ? opacity.disabled : 1,
        },
        variantStyle.container,
        sizeStyle.container,
        animatedStyle,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      hitSlop={interaction.hitSlop}
    >
      {loading ? (
        <Animated.View style={spinStyle}>
          <Loader
            size={size === "small" ? spinnerSize.sm : spinnerSize.md}
            color={variantStyle.spinner}
            strokeWidth={spinnerSize.strokeWidth}
          />
        </Animated.View>
      ) : (
        <Box style={{ flexDirection: "row", alignItems: "center" }}>
          {leftIcon && (
            <Box style={{ marginRight: spacing.sm }}>{leftIcon}</Box>
          )}
          <Text
            variant={size === "large" ? "bodyLarge" : "body"}
            style={[
              { textAlign: "center" },
              variantStyle.text,
              sizeStyle.text,
              labelStyle,
            ]}
          >
            {label}
          </Text>
          {rightIcon && (
            <Box style={{ marginLeft: spacing.sm }}>{rightIcon}</Box>
          )}
        </Box>
      )}
    </AnimatedPressable>
  );
});
