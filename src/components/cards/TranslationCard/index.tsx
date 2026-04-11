import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { lightTokens } from '@/constants/tokens';

interface TranslationCardProps {
  text: string;
  lang: string;
}

export const TranslationCard: React.FC<TranslationCardProps> = ({
  text,
  lang,
}) => {
  return (
    <View style={styles.card}>
      <Text style={styles.lang}>{lang.toUpperCase()}</Text>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: lightTokens.space[4],
    backgroundColor: lightTokens.color.translation.surface,
    borderRadius: lightTokens.radius.md,
  },
  lang: {
    fontFamily: lightTokens.font.family.bodyMed,
    fontSize: lightTokens.font.size.label,
    color: lightTokens.color.brand.primary,
    letterSpacing: lightTokens.font.letterSpacing.label,
    marginBottom: lightTokens.space[1],
  },
  text: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.primary,
    lineHeight: lightTokens.font.lineHeight.body,
  },
});
