import React from 'react';
import { Text, TextStyle } from 'react-native';

import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';

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
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';

  // Default color based on theme
  const defaultColor = getColor('foreground', isDark);

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
