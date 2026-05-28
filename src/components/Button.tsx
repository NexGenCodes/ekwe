import * as Haptics from "expo-haptics";
import { Loader } from "lucide-react-native";
import React, { useRef, useEffect } from "react";
import {
  Animated,
  Easing,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";

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

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
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

export const Button = ({
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
}: ButtonProps): React.ReactElement => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const { color } = useTheme();

  useEffect(() => {
    if (!loading) {
      spinAnim.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return (): void => animation.stop();
  }, [loading, spinAnim]);

  const spinDeg = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const handlePressIn = (): void => {
    if (disabled || loading) return;
    Animated.timing(scaleAnim, {
      toValue: 0.95,
      duration: 120,
      useNativeDriver: true,
    }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = (): void => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  interface VariantStyles {
    container: object;
    text: object;
    spinner: string;
  }

  interface SizeStyles {
    container: object;
    text: object;
  }

  const variantStyles = function (): VariantStyles {
    switch (variant) {
      case "primary":
        return {
          container: { backgroundColor: color.secondary },
          text: { color: color.onSecondary },
          spinner: color.onSecondary,
        };
      case "secondary":
        return {
          container: { backgroundColor: `${color.secondary}1A` },
          text: { color: color.secondary },
          spinner: color.secondary,
        };
      case "outline":
        return {
          container: {
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor: color.secondary,
          },
          text: { color: color.secondary },
          spinner: color.secondary,
        };
      case "ghost":
        return {
          container: { backgroundColor: "transparent" },
          text: { color: color.secondary },
          spinner: color.secondary,
        };
    }
  };

  const sizeStyles = function (): SizeStyles {
    switch (size) {
      case "small":
        return {
          container: {
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            minHeight: 48,
          },
          text: { fontFamily: typography.label.fontFamily },
        };
      case "large":
        return {
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
      case "medium":
      case "md":
      default:
        return {
          container: {
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            minHeight: 48,
          },
          text: { fontFamily: typography.label.fontFamily },
        };
    }
  };

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
          transform: [{ scale: scaleAnim }],
        },
        variantStyles().container,
        sizeStyles().container,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      hitSlop={interaction.hitSlop}
    >
      {loading ? (
        <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
          <Loader
            size={size === "small" ? spinnerSize.sm : spinnerSize.md}
            color={variantStyles().spinner}
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
              variantStyles().text,
              sizeStyles().text,
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
};
