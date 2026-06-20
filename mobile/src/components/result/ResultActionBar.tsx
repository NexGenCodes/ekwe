import React from "react";
import { StyleSheet } from "react-native";

import { Button } from "@/components";
import { Box } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface ResultActionBarProps {
  onCopyAll: () => void;
  isCopied: boolean;
}

export function ResultActionBar({
  onCopyAll,
  isCopied,
}: ResultActionBarProps): React.JSX.Element {
  const { color } = useTheme();

  const actionBarStyle = React.useMemo(
    () => [
      styles.actionBar,
      { borderTopColor: color.border, backgroundColor: color.background },
    ],
    [color.border, color.background],
  );

  return (
    <Box style={actionBarStyle}>
      <Button
        variant="outline"
        size="large"
        label={isCopied ? "Copied" : "Copy Full Translation"}
        onPress={onCopyAll}
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
  },
});
