import React, { forwardRef } from 'react';
import type { View } from 'react-native';

import { iconSize, type IconSizeKey } from '@/constants/sizes';
import { useTokens } from '@/hooks/ui/useTokens';

export type IconProps = {
  icon: React.ComponentType<{
    size: number;
    color: string;
    strokeWidth?: number;
  }>;
  size?: IconSizeKey;
  color?: string;
  strokeWidth?: number;
};

export const Icon = React.memo(
  forwardRef<View, IconProps>(
    ({ icon: IconComponent, size = 'md', color, strokeWidth }, ref) => {
      const { color: tokens } = useTokens();

      const iconColor = color ?? tokens.foreground;
      const iconSizeValue = iconSize[size];

      return (
        <IconComponent
          size={iconSizeValue}
          color={iconColor}
          strokeWidth={strokeWidth}
        />
      );
    },
  ),
);

Icon.displayName = 'Icon';
