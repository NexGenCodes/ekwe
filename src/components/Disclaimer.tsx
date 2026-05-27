import { Link } from 'expo-router';
import React from 'react';

import { Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

export const Disclaimer: React.FC = () => {
  const { color } = useTheme();
  return (
    <Text
      variant="caption"
      style={{
        textAlign: 'center',
        color: color.muted,
        marginTop: spacing['2xl'],
        marginBottom: spacing.xl,
        paddingHorizontal: spacing.md,
      }}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      By continuing, you agree to our{' '}
      <Link href="/legal/terms" style={{ color: color.secondary, textDecorationLine: 'underline' }}>
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/legal/privacy" style={{ color: color.secondary, textDecorationLine: 'underline' }}>
        Privacy Policy
      </Link>
      .
    </Text>
  );
};

export default Disclaimer;
