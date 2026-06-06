import React from "react";
import { StyleSheet } from "react-native";

import { Box, Spinner, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export function ResultProcessingIndicator(): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Box style={styles.container}>
      <Spinner size="lg" />
      <Box style={styles.textContainer}>
        <Text variant="bodyLarge" style={{ color: color.foreground }}>
          Processing Audio
        </Text>
        <Text
          variant="bodySmall"
          style={{ marginTop: spacing.xs, color: color.muted }}
        >
          This usually takes a few seconds...
        </Text>
      </Box>
    </Box>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: spacing["3xl"],
    gap: spacing.md,
  },
  textContainer: {
    alignItems: "center",
  },
});
