import React from 'react';
import { Text, StyleSheet } from 'react-native';

export interface SectionHeaderProps {
  title: string;
}

export const SectionHeader = ({
  title,
}: SectionHeaderProps): React.ReactElement => (
  <Text style={styles.header}>{title}</Text>
);

const styles = StyleSheet.create({
  header: {
    fontFamily: 'Outfit-Medium', // approx for font-display
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 12,
    color: '#71717A', // zinc-500
  },
});
