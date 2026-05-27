/**
 * Divider — Horizontal line with optional centered label.
 */
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { Box, Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface DividerProps {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export const Divider = ({ label, style }: DividerProps): React.ReactElement => {
  const { color } = useTheme();
  const borderColor = color.border;

  return (
    <Box
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          marginVertical: spacing.lg,
        },
        style,
      ]}
    >
      <Box style={{ flex: 1, height: 1, backgroundColor: borderColor }} />
      {label ? (
        <Text
          variant="bodySmall"
          style={{
            color: color.muted,
            marginHorizontal: spacing.md,
          }}
        >
          {label}
        </Text>
      ) : null}
      <Box style={{ flex: 1, height: 1, backgroundColor: borderColor }} />
    </Box>
  );
};
