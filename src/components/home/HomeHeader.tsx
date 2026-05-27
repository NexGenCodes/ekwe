import React from 'react';

import { IconContainer } from '../IconContainer';

import { EkweLogo } from '@/components/EkweLogo';
import { AccountStatusPill } from '@/components/home/AccountStatusPill';
import { Box, Text } from '@/components/ui';
import { iconSize } from '@/constants';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

export const HomeHeader = React.memo(function HomeHeader(): React.ReactElement {
  const { color } = useTheme();

  // Expose a single accessibility header for the whole header region
  // rather than marking multiple text nodes as headers.
  return (
    <Box
      accessible
      accessibilityRole="header"
      accessibilityLabel="Ekwe. Ready to translate."
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.md,
      }}
    >
      <Box
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        }}
      >
        <IconContainer
          size="xl"
          variant="custom"
          backgroundColor={`${color.secondary}15`}
        >
          <EkweLogo size={iconSize.xl} color={color.secondary} />
        </IconContainer>
        <Box>
          <Text variant="display">Ekwe</Text>
          <Text variant="body">Ready to translate.</Text>
        </Box>
      </Box>

      <AccountStatusPill />
    </Box>
  );
});
