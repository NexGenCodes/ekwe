import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface BadgeProps {
  label: string;
  /** Color variant */
  variant?: "primary" | "muted" | "success" | "warning" | "error";
  /** Optional leading icon */
  icon?: React.ReactNode;
  /** Text size preset */
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const VARIANT_CONFIG = {
  primary: { bgOpacity: "20", textKey: "foreground" },
  muted: { bgOpacity: "20", textKey: "muted" },
  success: { bgOpacity: "20", textKey: "foreground" },
  warning: { bgOpacity: "20", textKey: "warning" },
  error: { bgOpacity: "20", textKey: "error" },
} as const;

/**
 * Badge — Small pill label.
 * Replaces all inline tier badges, provider badges, and status indicators.
 */
export const Badge = ({
  label,
  variant = "primary",
  icon,
  size = "sm",
  style,
  testID,
}: BadgeProps): React.ReactElement => {
  const { color } = useTheme();
  const config = VARIANT_CONFIG[variant];
  const textColor = color[config.textKey as keyof typeof color] as string;
  const bgColor = `${textColor}${config.bgOpacity}`;

  return (
    <Box
      testID={testID}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: size === "sm" ? spacing.sm : spacing.md,
          paddingVertical: size === "sm" ? spacing.xs - 1 : spacing.xs,
          borderRadius: borderRadius["2xl"],
          backgroundColor: bgColor,
          gap: spacing.xs,
        },
        style,
      ]}
    >
      {icon}
      <Text
        variant={size === "sm" ? "caption" : "bodySmall"}
        style={{
          color: textColor,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </Box>
  );
};
