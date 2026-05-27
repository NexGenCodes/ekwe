import React, { forwardRef } from 'react';
import {
  KeyboardAvoidingView,
  type KeyboardAvoidingViewProps,
} from 'react-native';
import { isIOS } from '@/utils';

export type KeyboardAwareProps = KeyboardAvoidingViewProps;

export const KeyboardAware = React.memo(
  forwardRef<KeyboardAvoidingView, KeyboardAwareProps>(
    ({ behavior, style, ...props }, ref) => (
      <KeyboardAvoidingView
        ref={ref}
        behavior={(behavior ?? isIOS) ? 'padding' : undefined}
        style={[{ flex: 1 }, style]}
        {...props}
      />
    ),
  ),
);

KeyboardAware.displayName = 'KeyboardAware';
