import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Box } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { useTheme } from "@/hooks";

export interface IconContainerProps {
  children: React.ReactNode;
  /** Diameter preset or custom number */
  size?: "sm" | "md" | "lg" | "xl" | number;
  /** Background tint color */
  variant?: "primary" | "muted" | "custom";
  /** Custom background color (when variant='custom') */
  backgroundColor?: string;
  /** Shape */
  rounded?: "full" | "lg";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_MAP = {
  sm: 36,
  md: 40,
  lg: 48,
  xl: 64,
} as const;

/**
 * IconContainer — Circular or rounded icon wrapper with tinted background.
 * Replaces 10+ inline icon wrapper patterns across all screens.
 */
export const IconContainer = ({
  children,
  size = "md",
  variant = "primary",
  backgroundColor,
  rounded = "full",
  style,
  testID,
}: IconContainerProps): React.ReactElement => {
  const { color } = useTheme();

  const bg = ((): string => {
    if (variant === "custom" && backgroundColor) return backgroundColor;
    if (variant === "muted") return `${color.muted}20`;
    return `${color.primary}15`;
  })();

  const dimension = typeof size === "number" ? size : SIZE_MAP[size];

  return (
    <Box
      testID={testID}
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: rounded === "full" ? dimension / 2 : borderRadius.xl,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {children}
    </Box>
  );
};
