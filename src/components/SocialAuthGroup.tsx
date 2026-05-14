/**
 * SocialAuthGroup — Apple + Google buttons composed together.
 */
import React from 'react';
import { View } from 'react-native';

import { SocialButton } from './SocialButton';

interface SocialAuthGroupProps {
  onApple: () => void;
  onGoogle: () => void;
  action?: 'sign-in' | 'sign-up';
}

export const SocialAuthGroup = ({
  onApple,
  onGoogle,
  action = 'sign-in',
}: SocialAuthGroupProps): React.ReactElement => (
  <View style={{ gap: 12 }}>
    <SocialButton provider="apple" action={action} onPress={onApple} />
    <SocialButton provider="google" action={action} onPress={onGoogle} />
  </View>
);
