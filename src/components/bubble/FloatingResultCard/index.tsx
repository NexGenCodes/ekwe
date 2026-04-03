import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

interface FloatingResultCardProps {
  transcript: string;
}

export const FloatingResultCard: React.FC<FloatingResultCardProps> = ({
  transcript,
}) => {
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{transcript}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: lightTokens.space[4],
    backgroundColor: lightTokens.color.translation.surface,
    borderRadius: lightTokens.radius.lg,
  },
  text: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.primary,
  },
});
