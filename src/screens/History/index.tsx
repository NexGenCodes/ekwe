import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

export const HistoryScreen: React.FC = () => (
  <View style={styles.container}>
    <Text style={styles.title}>History</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightTokens.color.background.primary,
  },
  title: {
    fontFamily: lightTokens.font.family.bodyMed,
    fontSize: lightTokens.font.size.heading,
    color: lightTokens.color.text.primary,
  },
});
