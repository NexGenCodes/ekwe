import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';

import { useTheme } from '@/hooks';

export interface CardProps {
  children: React.ReactNode;
  /** default = filled bg, outlined = border only, accent = primary tint */
  variant?: 'default' | 'outlined' | 'accent';
  /** Padding preset. 'none' for custom padding via style. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Clip children to card bounds (needed for grouped rows) */
  overflow?: boolean;
  style?: StyleProp<ViewStyle>;
  className?: string;
}

const PADDING_MAP = {
  none: 0,
  sm: 12,
  md: 16,
  lg: 24,
} as const;

/**
 * Card — Universal container primitive.
 * Replaces all inline `bg-card rounded-[24px] border border-border` patterns.
 */
export const Card = ({
  children,
  variant = 'default',
  padding = 'md',
  overflow = false,
  style,
  className,
}: CardProps): React.ReactElement => {
  const { color } = useTheme();

  const variantStyles: ViewStyle = ((): ViewStyle => {
    switch (variant) {
      case 'accent':
        return {
          backgroundColor: `${color.primary}08`,
          borderColor: `${color.primary}30`,
          borderWidth: 1,
        };
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          borderColor: color.border,
          borderWidth: 1,
        };
      default:
        return {
          backgroundColor: color.card,
          borderColor: color.border,
          borderWidth: 1,
        };
    }
  })();

  return (
    <View
      className={className}
      style={[
        {
          borderRadius: 24,
          padding: PADDING_MAP[padding],
          overflow: overflow ? 'hidden' : undefined,
        },
        variantStyles,
        style,
      ]}
    >
      {children}
    </View>
  );
};
