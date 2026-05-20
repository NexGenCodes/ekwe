/**
 * Divider — Horizontal line with optional centered label.
 */
import React from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/hooks';

interface DividerProps {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export const Divider = ({ label, style }: DividerProps): React.ReactElement => {
  const { color } = useTheme();
  const borderColor = color.border;

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          marginVertical: 24,
        },
        style,
      ]}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: borderColor }} />
      {label ? (
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: 13,
            color: color.muted,
            marginHorizontal: 16,
          }}
        >
          {label}
        </Text>
      ) : null}
      <View style={{ flex: 1, height: 1, backgroundColor: borderColor }} />
    </View>
  );
};
