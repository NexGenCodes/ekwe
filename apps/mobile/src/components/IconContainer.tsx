import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Box } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { useTheme } from "@/hooks/ui";
import { withAlpha } from "@/utils/color";

export interface IconContainerProps {
  children: React.ReactNode;

  size?: "sm" | "md" | "lg" | "xl" | number;

  variant?: "primary" | "muted" | "custom";

  backgroundColor?: string;

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
    if (variant === "muted") return withAlpha(color.muted, 0.125);
    return withAlpha(color.foreground, 0.082);
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
