import React, { forwardRef } from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { typography, type TypographyVariant } from '@/constants/typography';
import { useTokens } from '@/hooks/ui/useTokens';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
};

export const Text = React.memo(
  forwardRef<RNText, TextProps>(
    ({ variant = 'body', style, ...props }, ref) => {
      const { color } = useTokens();

      return (
        <RNText
          ref={ref}
          style={[typography[variant], { color: color.foreground }, style]}
          {...props}
        />
      );
    },
  ),
);

Text.displayName = 'Text';
