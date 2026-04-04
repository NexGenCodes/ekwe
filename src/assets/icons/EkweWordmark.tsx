import React from 'react';
import { Text, TextStyle } from 'react-native';
import { useTheme } from 'src/hooks/useTheme';

export interface EkweWordmarkProps {
  size?: number;
  color?: string;
  centred?: boolean;
  style?: TextStyle;
}

export const EkweWordmark = ({
  size = 32,
  color,
  centred,
  style,
}: EkweWordmarkProps): React.JSX.Element => {
  const { tokens } = useTheme();

  return (
    <Text
      style={[
        {
          fontFamily: tokens.font.family.display,
          fontSize: size,
          color: color || tokens.color.brand.navy,
          textAlign: centred ? 'center' : 'auto',
        },
        style,
      ]}
    >
      Ekwe
    </Text>
  );
};
