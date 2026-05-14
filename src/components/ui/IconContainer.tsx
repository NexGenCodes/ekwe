import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/hooks';

export interface IconContainerProps {
  children: React.ReactNode;
  /** Diameter preset */
  size?: 'sm' | 'md' | 'lg';
  /** Background tint color */
  variant?: 'primary' | 'muted' | 'custom';
  /** Custom background color (when variant='custom') */
  backgroundColor?: string;
  /** Shape */
  rounded?: 'full' | 'lg';
  style?: StyleProp<ViewStyle>;
}

const SIZE_MAP = {
  sm: 36,
  md: 40,
  lg: 48,
} as const;

/**
 * IconContainer — Circular or rounded icon wrapper with tinted background.
 * Replaces 10+ inline icon wrapper patterns across all screens.
 */
export const IconContainer = ({
  children,
  size = 'md',
  variant = 'primary',
  backgroundColor,
  rounded = 'full',
  style,
}: IconContainerProps): React.ReactElement => {
  const { color } = useTheme();

  const bg = ((): string => {
    if (variant === 'custom' && backgroundColor) return backgroundColor;
    if (variant === 'muted') return `${color.muted}20`;
    return `${color.primary}15`;
  })();

  const dimension = SIZE_MAP[size];

  return (
    <View
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: rounded === 'full' ? dimension / 2 : 16,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};
