/**
 * Input — Base text input primitive.
 *
 * Supports field-level error display from react-hook-form.
 */
import React, { forwardRef, useState } from "react";
import { TextInput, type TextInputProps } from "react-native";

import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";

export interface InputProps extends TextInputProps {
  /** Field-level error message from react-hook-form */
  error?: string;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ error, style, ...props }, ref) => {
    const { color } = useTheme();
    const [isFocused, setIsFocused] = useState(false);

    return (
      <Box>
        <TextInput
          ref={ref}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={color.muted}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
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
              borderColor: error
                ? color.error
                : isFocused
                  ? color.secondary
                  : color.border,
            },
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
        ) : null}
      </Box>
    );
  },
);

Input.displayName = "Input";
