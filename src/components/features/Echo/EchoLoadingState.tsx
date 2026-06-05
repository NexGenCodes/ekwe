import React from "react";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";

export interface EchoLoadingStateProps {
  title: string;
  subtitle?: string;
}

/**
 * EchoLoadingState — Extracted loading UI for Echo workflow.
 * Used during Transcribing and Translating steps.
 */
export const EchoLoadingState = React.memo(function EchoLoadingState({
  title,
  subtitle = "Please wait...",
}: EchoLoadingStateProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Box
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: spacing["3xl"],
      }}
    >
      <Text variant="heading3" style={{ marginTop: spacing.lg }}>
        {title}
      </Text>
      <Text
        variant="bodySmall"
        style={{ marginTop: spacing.sm, color: color.muted }}
      >
        {subtitle}
      </Text>
    </Box>
  );
});
