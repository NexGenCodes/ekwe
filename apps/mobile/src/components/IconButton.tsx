import { triggerHaptic } from "@/utils/haptics";
import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Pressable } from "@/components/ui";
import { opacity } from "@/constants/sizes";

export interface IconButtonProps {
  icon: React.ReactNode;
  onPress: () => void | Promise<void>;
  onLongPress?: () => void | Promise<void>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  size?: number;
  accessibilityLabel?: string;
}

export const IconButton = ({
  icon,
  onPress,
  onLongPress,
  disabled = false,
  style,
  backgroundColor = "transparent",
  size = 64,
  accessibilityLabel,
}: IconButtonProps): React.ReactElement => {
  const label = accessibilityLabel ?? "Action";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={async () => {
        if (!disabled) {
          await onPress();
        }
      }}
      onLongPress={async () => {
        if (!disabled && onLongPress) {
          await triggerHaptic();
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
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? opacity.disabled : 1,
        },
        pressed && !disabled && { transform: [{ scale: 0.95 }] },
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
};
