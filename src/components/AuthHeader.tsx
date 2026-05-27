/**
 * AuthHeader — Brand lockup for auth screens.
 */
import React from 'react';

import { EkweLogo } from './EkweLogo';

import { Box, Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface AuthHeaderProps {
  subtitle: string;
  caption?: string;
}

export const AuthHeader = ({
  subtitle,
  caption,
}: AuthHeaderProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Box style={{ alignItems: 'center', marginBottom: spacing['2xl'] }}>
      <Box
        style={{
          marginBottom: spacing.md,
        }}
      >
        <EkweLogo size={64} color={color.secondary} />
      </Box>
      <Text variant="display">Ekwe</Text>
      <Text
        variant="body"
        style={{
          color: color.muted,
          marginTop: spacing.sm,
          textAlign: 'center',
        }}
      >
        {subtitle}
      </Text>
      {caption ? (
        <Text
          variant="bodySmall"
          style={{
            color: color.muted,
            marginTop: spacing.xs,
            textAlign: 'center',
          }}
        >
          {caption}
        </Text>
      ) : null}
    </Box>
  );
};
