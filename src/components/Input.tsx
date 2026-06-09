import React, { forwardRef, useState } from "react";
import { TextInput, type TextInputProps } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";

import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";

export interface InputProps extends TextInputProps {
  error?: string;
  label?: string;
  helperText?: string;
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export const Input = forwardRef<TextInput, InputProps>(
  ({ error, label, helperText, style, ...props }, ref) => {
    const { color } = useTheme();
    const [isFocused, setIsFocused] = useState(false);
    const focusProgress = useSharedValue(0);

    const animatedBorderStyle = useAnimatedStyle(() => {
      if (error) {
        return { borderColor: color.error };
      }
      const borderColorValue = interpolateColor(
        focusProgress.value,
        [0, 1],
        [color.border, color.secondary]
      );
      return { borderColor: borderColorValue };
    });

    return (
      <Box>
        {label ? (
          <Text
            variant="label"
            style={{
              color: color.foreground,
              marginBottom: spacing.sm,
              paddingHorizontal: spacing.xs,
            }}
          >
            {label}
          </Text>
        ) : null}
        <AnimatedTextInput
          ref={ref as React.Ref<Animated.AnimatedComponent<typeof TextInput>>}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={color.muted}
          onFocus={(e) => {
            setIsFocused(true);
            focusProgress.value = withTiming(1, { duration: 200 });
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            focusProgress.value = withTiming(0, { duration: 200 });
            props.onBlur?.(e);
          }}
          style={[
            {
              backgroundColor: color.card,
              borderRadius: borderRadius.xl,
              padding: spacing.md + 2,
              color: color.foreground,
              ...typography.body,
              borderWidth: 1,
            },
            animatedBorderStyle,
            style,
          ]}
          {...props}
        />
        {error ? (
          <Text
            variant="bodySmall"
            style={{
              color: color.error,
              marginTop: spacing.xs,
              paddingHorizontal: spacing.xs,
            }}
          >
            {error}
          </Text>
        ) : helperText ? (
          <Text
            variant="caption"
            style={{
              color: color.muted,
              marginTop: spacing.xs,
              paddingHorizontal: spacing.xs,
            }}
          >
            {helperText}
          </Text>
        ) : null}
      </Box>
    );
  },
);

Input.displayName = "Input";
