import { useColorScheme } from 'nativewind';
import React from 'react';
import { Text, TextStyle } from 'react-native';
import { getColor } from 'src/constants/colors';

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
  const { colorScheme } = useColorScheme();
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
