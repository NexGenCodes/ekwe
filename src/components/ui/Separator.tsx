import React, { forwardRef } from 'react';
import { View, type ViewProps } from 'react-native';

import { useTokens } from '@/hooks/ui/useTokens';

export type SeparatorProps = ViewProps & {
  orientation?: 'horizontal' | 'vertical';
};

export const Separator = React.memo(
  forwardRef<View, SeparatorProps>(
    ({ orientation = 'horizontal', style, ...props }, ref) => {
      const { color } = useTokens();

      return (
        <View
          ref={ref}
          accessibilityElementsHidden
          style={[
            orientation === 'horizontal'
              ? { height: 1, width: '100%' }
              : { width: 1, height: '100%' },
            { backgroundColor: color.border },
            style,
          ]}
          {...props}
        />
      );
    },
  ),
);

Separator.displayName = 'Separator';
