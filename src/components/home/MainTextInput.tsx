import React, { useMemo } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';

import { spacing, typography } from '@/constants/designTokens';
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
      return [
        styles.input,
        {
          color: color.foreground,
          fontSize: 18,
          lineHeight: 26,
          fontFamily: 'Outfit-Bold',
          paddingHorizontal: spacing[6],
          minHeight: 120,
          maxHeight: 240,
        },
      ];
    }, [color.foreground]);

    const charCountStyle = useMemo(
      () => [
        styles.charCount,
        { color: value.length >= maxChars ? color.error : color.muted },
      ],
      [value.length, maxChars, color.error, color.muted],
    );

    return (
      <View style={styles.inputWrapper}>
        <TextInput
          style={inputStyle}
          placeholder="Start typing..."
          placeholderTextColor={color.muted}
          value={value}
          onChangeText={onChangeText}
          multiline
          textAlignVertical="top"
          selectionColor={color.secondary}
          maxLength={maxChars}
          scrollEnabled={true}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <View style={styles.charCountContainer}>
          <Text style={charCountStyle}>
            {value.length}/{maxChars}
          </Text>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  inputWrapper: {
    flex: 1,
    position: 'relative',
  },
  input: {
    fontFamily: 'Outfit-Medium',
    flex: 1,
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
  charCountContainer: {
    paddingHorizontal: spacing[6],
    alignItems: 'flex-end',
    marginTop: spacing[1],
  },
  charCount: {
    fontFamily: 'Outfit-Medium',
    fontSize: typography.caption.size,
  },
});
