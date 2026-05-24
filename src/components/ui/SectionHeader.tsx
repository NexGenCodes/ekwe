import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { spacing, typography } from '@/constants/designTokens';

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
    fontFamily: 'Outfit-Medium',
    fontSize: typography.caption.size,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[8],
    paddingBottom: spacing[3],
    color: '#71717A',
  },
});
