import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Copy, CheckCircle2 } from 'lucide-react-native';
import React, { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { Pressable, Box } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';

interface Props {
  textToCopy: string;
  style?: StyleProp<ViewStyle>;
  color?: string;
  size?: number;
  children?: React.ReactNode;
}

export const AnimatedCopyButton: React.FC<Props> = ({
  textToCopy,
  style,
  color: iconColorProp,
  size = 20,
  children,
}) => {
  const { color } = useTheme();
  const [copied, setCopied] = useState(false);

  const iconColor = iconColorProp || color.muted;
  const successColor = color.success;

  const handleCopy = async (): Promise<void> => {
    if (copied || !textToCopy) return;

    Haptics.selectionAsync();
    await Clipboard.setStringAsync(textToCopy);
    setCopied(true);

    // Reset after 3 seconds
    setTimeout(() => {
      setCopied(false);
    }, 3000);
  };

  return (
    <Pressable onPress={handleCopy} hitSlop={12} style={style}>
      <Box
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        {copied ? (
          <CheckCircle2 color={successColor} size={size} strokeWidth={2.5} />
        ) : (
          <Copy color={iconColor} size={size} strokeWidth={2} />
        )}
        {children}
      </Box>
    </Pressable>
  );
};
