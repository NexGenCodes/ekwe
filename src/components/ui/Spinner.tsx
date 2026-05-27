import React, { forwardRef } from 'react';
import {
  ActivityIndicator,
  type ActivityIndicatorProps,
  type View,
} from 'react-native';

import { useTokens } from '@/hooks/ui/useTokens';

export type SpinnerProps = Omit<ActivityIndicatorProps, 'size'> & {
  size?: 'sm' | 'md' | 'lg';
};

export const Spinner = React.memo(
  forwardRef<View, SpinnerProps>(({ size = 'md', color, ...props }, ref) => {
    const { color: tokens } = useTokens();

    const sizeValue = size === 'sm' ? 16 : size === 'lg' ? 32 : 24;

    return (
      <ActivityIndicator
        ref={ref}
        size={sizeValue}
        color={color ?? tokens.primary}
        accessibilityRole="progressbar"
        {...props}
      />
    );
  }),
);

Spinner.displayName = 'Spinner';
