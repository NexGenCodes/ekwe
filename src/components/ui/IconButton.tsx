import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleProp, ViewStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

export interface IconButtonProps {
  icon: React.ReactNode;
  onPress: () => void | Promise<void>;
  onLongPress?: () => void | Promise<void>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  size?: number;
  accessibilityLabel: string;
}

export const IconButton = ({
  icon,
  onPress,
  onLongPress,
  disabled = false,
  style,
  backgroundColor = 'transparent',
  size = 64,
  accessibilityLabel,
}: IconButtonProps): React.ReactElement => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={async () => {
        if (!disabled) {
          await onPress();
        }
      }}
      onLongPress={async () => {
        if (!disabled && onLongPress) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          await onLongPress();
        }
      }}
      disabled={disabled}
      hitSlop={size < 44 ? { top: 4, bottom: 4, left: 4, right: 4 } : undefined}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        },
        pressed && !disabled && { transform: [{ scale: 0.95 }] },
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
};
