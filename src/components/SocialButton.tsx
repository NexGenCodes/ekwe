/**
 * SocialButton — Apple / Google sign-in button.
 *
 * Apple button auto-hides on Android.
 */
import React from 'react';
import { TouchableOpacity, Text, Platform } from 'react-native';

import { useTheme } from '@/hooks';

interface SocialButtonProps {
  provider: 'apple' | 'google';
  action?: 'sign-in' | 'sign-up';
  onPress: () => void;
}

const LABELS = {
  apple: { 'sign-in': 'Continue with Apple', 'sign-up': 'Sign up with Apple' },
  google: {
    'sign-in': 'Continue with Google',
    'sign-up': 'Sign up with Google',
  },
} as const;

export const SocialButton = ({
  provider,
  action = 'sign-in',
  onPress,
}: SocialButtonProps): React.ReactElement | null => {
  const { color } = useTheme();

  if (provider === 'apple' && Platform.OS !== 'ios') return null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor: color.card,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: color.border,
      }}
      accessibilityRole="button"
      accessibilityLabel={LABELS[provider][action]}
    >
      <Text style={{ fontSize: 20, color: color.foreground }}>
        {provider === 'apple' ? '' : 'G'}
      </Text>
      <Text
        style={{
          fontFamily: 'Outfit-Medium',
          fontSize: 15,
          color: color.foreground,
        }}
      >
        {LABELS[provider][action]}
      </Text>
    </TouchableOpacity>
  );
};
