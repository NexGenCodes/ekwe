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
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: color.card,
          borderColor: color.border,
        },
        pressed && { transform: [{ scale: 0.96 }] },
        style,
      ]}
    >
      <Text style={styles.pillFlag}>
        {!langCode
          ? '🔍'
          : langCode === 'auto'
            ? '🌐'
            : FLAG_MAP[langCode] || '🏳️'}
      </Text>
      <Text
        style={[
          styles.langText,
          { color: !langCode ? color.muted : color.foreground },
        ]}
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

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  pillFlag: {
    fontSize: 15,
  },
  langText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 13,
    letterSpacing: 0.3,
    marginRight: 2,
  },
});
