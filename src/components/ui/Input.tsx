/**
 * Input — Base text input primitive.
 *
 * Supports field-level error display from react-hook-form.
 */
import React, { forwardRef, useState } from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';

import { borderRadius, spacing, typography } from '@/constants/designTokens';
import { useTheme } from '@/hooks';

export interface InputProps extends TextInputProps {
  /** Field-level error message from react-hook-form */
  error?: string;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ error, style, ...props }, ref) => {
    const { color } = useTheme();
    const [isFocused, setIsFocused] = useState(false);

    return (
      <View>
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
              padding: spacing[4] + 2,
              color: color.foreground,
              fontFamily: 'Outfit-Regular',
              fontSize: typography.body.size,
              borderWidth: 1.5,
              borderColor: error
                ? '#EF4444'
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
            style={{
              color: '#EF4444',
              fontFamily: 'Outfit-Regular',
              fontSize: typography.bodySmall.size - 1,
              marginTop: spacing[1],
              paddingHorizontal: spacing[1],
            }}
          >
            {error}
          </Text>
        ) : null}
      </View>
    );
  },
);

Input.displayName = 'Input';
