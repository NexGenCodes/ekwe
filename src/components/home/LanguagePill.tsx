import { ChevronDown } from 'lucide-react-native';
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { Text, Pressable } from '@/components/ui';
import { shadows } from '@/constants';
import { FLAG_MAP, getLanguageAbbreviation } from '@/constants/languages';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

export interface LanguagePillProps {
  langCode: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function LanguagePill({
  langCode,
  onPress,
  style,
}: LanguagePillProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => [
        {
          flex: 1,
          flexDirection: 'row',
          gap: spacing.sm,
          height: 44,
          borderRadius: borderRadius['2xl'],
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
          backgroundColor: color.card,
          borderColor: color.border,
        },
        pressed && { transform: [{ scale: 0.96 }] },
        style,
      ]}
    >
      <Text variant="body">
        {!langCode
          ? '🔍'
          : langCode === 'auto'
            ? '🌐'
            : FLAG_MAP[langCode] || '🏳️'}
      </Text>
      <Text
        variant="bodySmall"
        style={{
          marginRight: spacing.xs,
          color: !langCode ? color.muted : color.foreground,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {!langCode ? 'Select' : getLanguageAbbreviation(langCode)}
      </Text>
      <ChevronDown size={14} color={color.muted} strokeWidth={2.5} />
    </Pressable>
  );
}
