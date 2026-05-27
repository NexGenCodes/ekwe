import React from 'react';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { palette } from '@/constants/colors';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface LensCardProps {
  transcript: string;
}

export function LensCard({ transcript }: LensCardProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      style={[
        {
          padding: spacing.lg,
          borderRadius: borderRadius['2xl'],
          borderWidth: 1,
          shadowColor: palette.neutral950,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.2,
          shadowRadius: 20,
          elevation: 15,
        },
        { backgroundColor: color.card, borderColor: color.border },
      ]}
    >
      <Text variant="body">{transcript}</Text>
    </Animated.View>
  );
}
