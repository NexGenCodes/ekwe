/**
 * AuthFooter — ToS + account toggle link.
 */
import React from 'react';

import { Pressable, Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface AuthFooterProps {
  text: string;
  linkText: string;
  onPress: () => void;
}

export const AuthFooter = ({
  text,
  linkText,
  onPress,
}: AuthFooterProps): React.ReactElement => {
  const { color } = useTheme();
  const actionColor = color.secondary;
  const mutedColor = color.muted;

  return (
    <>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: spacing.xs,
          marginTop: spacing.lg,
        }}
      >
        <Text variant="bodySmall" style={{ color: mutedColor }}>
          {text}
        </Text>
        <Text variant="bodySmall" style={{ color: actionColor }}>
          {linkText}
        </Text>
      </Pressable>

    </>
  );
};
