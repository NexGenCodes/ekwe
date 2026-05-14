import React from 'react';
import { View, Text } from 'react-native';

import { useTheme } from '@/hooks';

export interface EmptyStateProps {
  /** Icon element rendered above the title */
  icon: React.ReactNode;
  /** Primary message */
  title: string;
  /** Secondary description */
  subtitle?: string;
  /** Optional action element (button, link, etc.) below subtitle */
  action?: React.ReactNode;
}

/**
 * EmptyState — Centered placeholder for empty lists/screens.
 * Icon + title + subtitle with optional action slot.
 */
export const EmptyState = ({
  icon,
  title,
  subtitle,
  action,
}: EmptyStateProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
        paddingHorizontal: 24,
      }}
    >
      <View style={{ marginBottom: 16 }}>{icon}</View>
      <Text
        style={{
          fontSize: 20,
          fontFamily: 'Outfit-Bold',
          color: color.foreground,
          textAlign: 'center',
          marginBottom: subtitle ? 8 : 0,
        }}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            fontSize: 14,
            fontFamily: 'Outfit-Regular',
            color: color.muted,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          {subtitle}
        </Text>
      )}
      {action && <View style={{ marginTop: 20 }}>{action}</View>}
    </View>
  );
};
