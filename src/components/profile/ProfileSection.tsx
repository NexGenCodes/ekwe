import React from 'react';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { Box, Text } from '@/components/ui';
import { spring } from '@/constants';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

export interface ProfileSectionProps {
  title: string;
  titleColor?: string;
  children: React.ReactNode;
}

export function ProfileSection({
  title,
  titleColor,
  children,
}: ProfileSectionProps): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Box style={{ marginBottom: spacing.xl }}>
      <Text
        variant="caption"
        style={{
          textTransform: 'uppercase',
          marginBottom: spacing.md,
          color: titleColor ?? color.muted,
        }}
      >
        {title}
      </Text>
      <Animated.View
        layout={LinearTransition.springify()
          .damping(spring.smooth.damping)
          .stiffness(spring.smooth.stiffness)
          .mass(spring.smooth.mass)}
        style={{
          borderRadius: borderRadius['2xl'],
          borderWidth: 1,
          overflow: 'hidden',
          backgroundColor: color.card,
          borderColor: color.border,
        }}
      >
        {children}
      </Animated.View>
    </Box>
  );
}
