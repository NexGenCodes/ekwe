import React, { forwardRef } from 'react';
import { View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type SafeAreaProps = ViewProps;

export const SafeArea = React.memo(
  forwardRef<View, SafeAreaProps>(({ style, ...props }, ref) => (
    <SafeAreaView ref={ref} style={[{ flex: 1 }, style]} {...props} />
  )),
);

SafeArea.displayName = 'SafeArea';
