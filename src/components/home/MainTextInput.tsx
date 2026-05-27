import React, { useMemo } from 'react';
import { TextInput } from 'react-native';

import { Box, Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useTheme } from '@/hooks';

interface MainTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  maxChars: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const MainTextInput = React.memo(
  ({ value, onChangeText, maxChars, onFocus, onBlur }: MainTextInputProps) => {
    const { color } = useTheme();

    const inputStyle = useMemo(() => {
      return {
        color: color.foreground,
        ...typography.bodyLarge,
        paddingHorizontal: spacing.lg,
        minHeight: 100,
        maxHeight: 240,
        flex: 1,
        paddingVertical: spacing.sm,
      };
    }, [color.foreground]);

    return (
      <Box accessible accessibilityRole="text" style={{ flex: 1, position: 'relative' }}>
        <TextInput
          accessibilityLabel="Source text input"
          accessibilityHint="Type or paste text to translate."
          style={inputStyle}
          placeholder="Start typing..."
          placeholderTextColor={color.muted}
          value={value}
          onChangeText={onChangeText}
          multiline
          textAlignVertical="top"
          selectionColor={color.secondary}
          maxLength={maxChars}
          scrollEnabled
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <Box style={{ paddingHorizontal: spacing.lg, alignItems: 'flex-end' }}>
          <Text
            variant="caption"
            style={{
              color: value.length >= maxChars ? color.error : color.muted,
            }}
            accessibilityLiveRegion="polite"
          >
            {value.length}/{maxChars}
          </Text>
        </Box>
      </Box>
    );
  },
);
