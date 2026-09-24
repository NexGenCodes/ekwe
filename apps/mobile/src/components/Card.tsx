import React from "react";
import type { ViewStyle, StyleProp } from "react-native";

import { Box } from "@/components/ui";
import { shadows } from "@/constants/shadows";
import { borderRadius } from "@/constants/sizes";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

export interface CardProps {
  children: React.ReactNode;

  variant?: "default" | "outlined" | "accent";

  padding?: "none" | "sm" | "md" | "lg";

  overflow?: boolean;
  style?: StyleProp<ViewStyle>;
}

const PADDING_MAP = {
  none: 0,
  sm: 12,
  md: 16,
  lg: 24,
} as const;

export const Card = ({
  children,
  variant = "default",
  padding = "md",
  overflow = false,
  style,
}: CardProps): React.ReactElement => {
  const { color } = useTheme();

  const variantStyles: ViewStyle = ((): ViewStyle => {
    switch (variant) {
      case "accent":
        return {
          backgroundColor: withAlpha(color.foreground, 0.031),
          borderColor: withAlpha(color.foreground, 0.188),
          borderWidth: 1,
        };
      case "outlined":
        return {
          backgroundColor: "transparent",
          borderColor: color.border,
          borderWidth: 1,
        };
      default:
        return {
          backgroundColor: color.card,
          borderColor: color.border,
          borderWidth: 1,
        };
    }
  })();

  return (
    <Box
      style={[
        {
          borderRadius: borderRadius.xl,
          padding: PADDING_MAP[padding],
          overflow: overflow ? "hidden" : undefined,
          boxShadow: variant === "default" ? shadows.soft : undefined,
        },
        variantStyles,
        style,
      ]}
    >
      {children}
    </Box>
  );
};
