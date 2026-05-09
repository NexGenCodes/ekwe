import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Copy, CheckCircle2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleProp, ViewStyle, View } from 'react-native';

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
  color,
  size = 20,
  children,
}) => {
  const [copied, setCopied] = useState(false);

  const iconColor = color || '#888888';
  const successColor = '#10b981'; // Generic brand success green

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {copied ? (
          <CheckCircle2 color={successColor} size={size} strokeWidth={2.5} />
        ) : (
          <Copy color={iconColor} size={size} strokeWidth={2} />
        )}
        {children}
      </View>
    </Pressable>
  );
};
