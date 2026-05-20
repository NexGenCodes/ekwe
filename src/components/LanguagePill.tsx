import { ChevronDown } from 'lucide-react-native';
import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';

import { FLAG_MAP, getLanguageAbbreviation } from '@/constants/languages';
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
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: color.surface },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Text style={styles.pillFlag}>
        {langCode === 'auto' ? '🌐' : FLAG_MAP[langCode] || '🏳️'}
      </Text>
      <Text
        style={[styles.langText, { color: color.foreground }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {getLanguageAbbreviation(langCode)}
      </Text>
      <ChevronDown size={18} color={color.muted} strokeWidth={2.5} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  pillFlag: {
    fontSize: 16,
    marginRight: 4,
  },
  langText: {
    flex: 1,
    fontFamily: 'Outfit-Bold',
    fontSize: 14,
    letterSpacing: 0.3,
    marginRight: 4,
  },
});
