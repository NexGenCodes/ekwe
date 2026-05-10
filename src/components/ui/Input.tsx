/**
 * Input — Base text input primitive.
 *
 * Supports field-level error display from react-hook-form.
 */
import React, { forwardRef } from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';

import { useTheme } from '@/hooks';

export interface InputProps extends TextInputProps {
  /** Field-level error message from react-hook-form */
  error?: string;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ error, style, ...props }, ref) => {
    const { isDark, color } = useTheme();

    return (
      <View>
        <TextInput
          ref={ref}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={color.muted}
          style={[
            {
              backgroundColor: color.card,
              borderRadius: 16,
              padding: 18,
              color: color.foreground,
              fontFamily: 'Outfit-Regular',
              fontSize: 16,
              borderWidth: error ? 1 : 0,
              borderColor: error ? '#EF4444' : 'transparent',
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
              fontSize: 13,
              marginTop: 4,
              paddingHorizontal: 4,
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
