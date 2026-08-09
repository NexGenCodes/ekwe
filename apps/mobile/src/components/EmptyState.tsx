import React from "react";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface EmptyStateProps {
  /** Icon element rendered above the title */
  icon?: React.ReactNode;
  /** Primary message */
  title: string;
  /** Secondary description */
  subtitle?: string;
  /** Optional action element (button, link, etc.) below subtitle */
  action?: React.ReactNode;
}

/**
 * EmptyState — Centered placeholder for empty lists/screens.
 * Icon + title + subtitle with optional action slot.
 */
export const EmptyState = ({
  icon,
  title,
  subtitle,
  action,
}: EmptyStateProps): React.ReactElement => {
  const { color } = useTheme();

  // Combine title and subtitle into a concise label for screen readers
  const accessibilityLabel = subtitle ? `${title}. ${subtitle}` : title;

  return (
    <Box
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: spacing["2xl"],
        paddingHorizontal: spacing.lg,
      }}
    >
      <Box style={{ marginBottom: spacing.md }}>{icon}</Box>
      <Text
        variant="heading3"
        style={{
          color: color.muted,
          textAlign: "center",
          marginBottom: subtitle ? spacing.sm : 0,
        }}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          variant="bodySmall"
          style={{
            color: color.muted,
            textAlign: "center",
          }}
        >
          {subtitle}
        </Text>
      )}
      {action ? <Box style={{ marginTop: spacing.lg }}>{action}</Box> : null}
    </Box>
  );
};
