/**
 * ErrorBanner — Inline error message. Renders nothing when empty.
 */
import React from 'react';

import { Box, Text } from '@/components/ui';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface ErrorBannerProps {
  message: string | null | undefined;
}

export const ErrorBanner = ({
  message,
}: ErrorBannerProps): React.ReactElement | null => {
  const { color } = useTheme();
  return message ? (
    <Box
      style={{
        backgroundColor: `${color.error}14`,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: `${color.error}26`,
      }}
    >
      <Text
        variant="bodySmall"
        style={{
          color: color.error,
          textAlign: 'center',
        }}
      >
        {message}
      </Text>
    </Box>
  ) : null;
};
