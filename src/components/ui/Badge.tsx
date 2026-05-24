import React from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';

import { borderRadius, spacing, typography } from '@/constants/designTokens';
import { useTheme } from '@/hooks';

export interface BadgeProps {
  label: string;
  /** Color variant */
  variant?: 'primary' | 'muted' | 'success' | 'warning' | 'error';
  /** Optional leading icon */
  icon?: React.ReactNode;
  /** Text size preset */
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

const VARIANT_CONFIG = {
  primary: { bgOpacity: '20', textKey: 'primary' },
  muted: { bgOpacity: '20', textKey: 'muted' },
  success: { bgOpacity: '20', textKey: 'primary' },
  warning: { bgOpacity: '20', textKey: 'warning' },
  error: { bgOpacity: '20', textKey: 'error' },
} as const;

/**
 * Badge — Small pill label.
 * Replaces all inline tier badges, provider badges, and status indicators.
 */
export const Badge = ({
  label,
  variant = 'primary',
  icon,
  size = 'sm',
  style,
}: BadgeProps): React.ReactElement => {
  const { color } = useTheme();
  const config = VARIANT_CONFIG[variant];
  const textColor = color[config.textKey as keyof typeof color] as string;
  const bgColor = `${textColor}${config.bgOpacity}`;

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: size === 'sm' ? spacing[2] : spacing[3],
          paddingVertical: size === 'sm' ? spacing[1] - 1 : spacing[1],
          borderRadius: borderRadius['2xl'],
          backgroundColor: bgColor,
          gap: spacing[1],
        },
        style,
      ]}
    >
      {icon}
      <Text
        style={{
          fontSize:
            size === 'sm'
              ? typography.caption.size - 1
              : typography.bodySmall.size - 1,
          fontWeight: '700',
          color: textColor,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
};
