import React from 'react';

import { Box, Text } from '@/components/ui';
import { shadows } from '@/constants';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface Props {
  transcript: string;
  isLive?: boolean;
}

export const TranscriptionView = ({
  transcript,
  isLive = false,
}: Props): React.JSX.Element => {
  const { color } = useTheme();

  return (
    <Box
      style={{
        borderRadius: borderRadius['2xl'],
        padding: spacing.lg,
        borderWidth: 1,
        minHeight: 140,
        ...shadows.soft,
        backgroundColor: color.card,
        borderColor: color.border,
      }}
    >
      <Text variant="heading3" style={{ color: color.foreground }}>
        {transcript || (isLive ? 'Listening...' : 'Waiting for audio...')}
      </Text>

      {isLive && (
        <Box
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: spacing.lg,
          }}
        >
          <Box
            style={{
              width: 10,
              height: 10,
              borderRadius: borderRadius.md,
              marginRight: spacing.sm,
              backgroundColor: color.primary,
            }}
          />
          <Text variant="caption" style={{ color: color.muted }}>
            Live Stream
          </Text>
        </Box>
      )}
    </Box>
  );
};
