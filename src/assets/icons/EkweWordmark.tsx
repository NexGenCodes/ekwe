import React from 'react';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks';

export interface EkweWordmarkProps {
  color?: string;
  centred?: boolean;
}

export const EkweWordmark = ({
  color,
  centred,
}: EkweWordmarkProps): React.JSX.Element => {
  const { color: themeColor } = useTheme();

  const defaultColor = themeColor.foreground;

  return (
    <Text
      variant="display"
      style={[
        {
          color: color || defaultColor,
          textAlign: centred ? 'center' : 'auto',
        },
      ]}
    >
      Ekwe
    </Text>
  );
};
