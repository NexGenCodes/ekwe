import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

interface ResultScreenProps {
  transcript?: string;
  translation?: string;
}

export const ResultScreen: React.FC<ResultScreenProps> = ({
  transcript = '',
  translation = '',
}) => (
  <View style={styles.container}>
    <Text style={styles.transcript}>{transcript}</Text>
    <Text style={styles.translation}>{translation}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: lightTokens.space[4],
    backgroundColor: lightTokens.color.background.primary,
  },
  transcript: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.primary,
    marginBottom: lightTokens.space[4],
  },
  translation: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.brand.core,
  },
});
