import React from 'react';
import { Text, TextStyle } from 'react-native';

import { useTheme } from '@/hooks';

export interface EkweWordmarkProps {
  size?: number;
  color?: string;
  centred?: boolean;
  style?: TextStyle;
}

export const EkweWordmark = ({
  size = 34,
  color,
  centred,
  style,
}: EkweWordmarkProps): React.JSX.Element => {
  const { color: themeColor } = useTheme();

  // Default color based on theme
  const defaultColor = themeColor.foreground;

  return (
    <Text
      className="font-display"
      style={[
        {
          fontSize: size,
          color: color || defaultColor,
          textAlign: centred ? 'center' : 'auto',
        },
        style,
      ]}
    >
      Ekwe
    </Text>
  );
};
