import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { lightTokens } from '@/constants/tokens';

interface HistoryItemProps {
  transcript: string;
  timestamp: number;
}

export const HistoryItem: React.FC<HistoryItemProps> = ({
  transcript,
  timestamp,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.text} numberOfLines={2}>
        {transcript}
      </Text>
      <Text style={styles.time}>
        {new Date(timestamp).toLocaleDateString()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: lightTokens.space[4],
    borderBottomWidth: 1,
    borderBottomColor: lightTokens.color.border.default,
  },
  text: {
    fontFamily: lightTokens.font.family.body,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.primary,
  },
  time: {
    fontFamily: lightTokens.font.family.mono,
    fontSize: lightTokens.font.size.caption,
    color: lightTokens.color.text.tertiary,
    marginTop: lightTokens.space[1],
  },
});
