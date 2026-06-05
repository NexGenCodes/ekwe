import Constants from "expo-constants";
import React from "react";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants";
import { useTheme } from "@/hooks";

export function ProfileFooter(): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Box style={{ alignItems: "center", paddingVertical: spacing.xl }}>
      <Text variant="caption" style={{ color: color.muted }}>
        Made by the Ekwe team
      </Text>
      <Text
        variant="caption"
        style={{
          marginTop: spacing.xs,
          color: color.muted,
        }}
      >
        v{Constants.expoConfig?.version ?? "1.0.0"}
      </Text>
    </Box>
  );
}
