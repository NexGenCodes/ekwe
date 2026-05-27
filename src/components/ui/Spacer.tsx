import React from 'react';
import { View } from 'react-native';

export const Spacer = React.memo(() => (
  <View style={{ flex: 1 }} accessibilityRole="none" />
));

Spacer.displayName = 'Spacer';
