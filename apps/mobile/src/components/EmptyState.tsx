import React from "react";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface EmptyStateProps {
  icon?: React.ReactNode;

  title: string;

  subtitle?: string;

  action?: React.ReactNode;
}

export const EmptyState = ({
  icon,
  title,
  subtitle,
  action,
}: EmptyStateProps): React.ReactElement => {
  const { color } = useTheme();

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
