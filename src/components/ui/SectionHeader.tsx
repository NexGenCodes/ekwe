import React from 'react';
import { Text } from 'react-native';

export interface SectionHeaderProps {
  title: string;
}

export const SectionHeader = ({
  title,
}: SectionHeaderProps): React.ReactElement => (
  <Text className="font-display text-xs uppercase tracking-[0.15em] px-6 pt-8 pb-3 text-muted dark:text-zinc-500">
    {title}
  </Text>
);
