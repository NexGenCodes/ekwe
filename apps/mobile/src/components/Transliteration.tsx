import CaseSensitive from "lucide-react-native/icons/case-sensitive";
import React from "react";
import { StyleSheet } from "react-native";
import { useValue } from "@legendapp/state/react";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { auth$ } from "@/store";
import { withAlpha } from "@/utils/color";

export interface TransliterationProps {
  text: string;

  tone?: "brand" | "default";
}

export const Transliteration = React.memo(function Transliteration({
  text,
  tone = "default",
}: TransliterationProps): React.ReactElement | null {
  const { color } = useTheme();
  const isPro = useValue(() => auth$.isPro.get());

  if (!isPro) return null;
  if (!text.trim()) return null;

  const isBrand = tone === "brand";

  const dividerColor = isBrand ? withAlpha(color.onBrand, 0.16) : color.border;
  const labelColor = isBrand ? withAlpha(color.onBrand, 0.72) : color.muted;
  const textColor = isBrand ? color.onBrand : color.foreground;

  return (
    <Box style={styles.root}>
      <Box style={[styles.divider, { backgroundColor: dividerColor }]} />
      <Box style={styles.labelRow}>
        <CaseSensitive size={14} color={labelColor} strokeWidth={2.25} />
        <Text variant="caption" style={[styles.label, { color: labelColor }]}>
          Romanized
        </Text>
      </Box>
      <Text
        variant="body"
        selectable
        style={[styles.text, { color: textColor }]}
      >
        {text}
      </Text>
    </Box>
  );
});

const styles = StyleSheet.create({
  root: {
    marginTop: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  label: {
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "600",
  },
  text: {
    marginTop: spacing.xs,
  },
});
