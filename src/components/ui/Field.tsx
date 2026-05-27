import React, { forwardRef, useMemo } from 'react';
import {
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/ui/Text';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useTokens } from '@/hooks/ui/useTokens';

export type FieldProps = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export const Field = React.memo(
  forwardRef<TextInput, FieldProps>(
    (
      { label, error, containerStyle, style, placeholderTextColor, ...props },
      ref,
    ) => {
      const { color, borderRadius: radii } = useTokens();

      const borderColor = useMemo(
        () => (error ? color.error : color.border),
        [error, color.error, color.border],
      );

      return (
        <View style={[{ gap: spacing.xs }, containerStyle]}>
          {label && (
            <Text variant="bodySmall" style={{ color: color.foreground }}>
              {label}
            </Text>
          )}
          <TextInput
            ref={ref}
            placeholderTextColor={placeholderTextColor ?? color.muted}
            style={[
              {
                borderWidth: 1,
                borderColor,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                ...typography.body,
                color: color.foreground,
                backgroundColor: color.card,
              },
              style,
            ]}
            accessibilityLabel={label || props.accessibilityLabel}
            {...props}
          />
          {error && (
            <Text
              variant="caption"
              style={[{ color: color.error }]}
              accessibilityRole="alert"
            >
              {error}
            </Text>
          )}
        </View>
      );
    },
  ),
);

Field.displayName = 'Field';
