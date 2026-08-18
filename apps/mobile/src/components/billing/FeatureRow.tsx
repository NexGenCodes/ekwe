import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import React from "react";

import { Box, Text } from "@/components/ui";
import type { PlanFeature } from "@/constants/billing";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";

export interface FeatureRowProps {
  feature: PlanFeature;
  accentColor: string;
  mutedColor: string;
  textColor: string;
  isPro: boolean;
  compact?: boolean;
}

export function FeatureRow({
  feature,
  accentColor,
  mutedColor,
  textColor,
  isPro,
  compact = false,
}: FeatureRowProps): React.JSX.Element {
  return (
    <Box style={compact ? styles.featureRowCompact : styles.featureRow}>
      {feature.included ? (
        <Box
          style={[
            compact ? styles.featureIconCompact : styles.featureIcon,
            {
              backgroundColor: isPro ? `${accentColor}25` : `${accentColor}15`,
            },
          ]}
        >
          <Check
            size={compact ? 12 : 14}
            color={accentColor}
            strokeWidth={3.5}
          />
        </Box>
      ) : (
        <Box
          style={[
            compact ? styles.featureIconCompact : styles.featureIcon,
            { backgroundColor: `${mutedColor}15` },
          ]}
        >
          <X size={compact ? 12 : 14} color={mutedColor} strokeWidth={2.5} />
        </Box>
      )}
      <Text
        variant="bodySmall"
        style={{ color: feature.included ? textColor : mutedColor, flex: 1 }}
      >
        {feature.title}
      </Text>
    </Box>
  );
}

const styles = {
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  } as const,
  featureRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
  } as const,
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  } as const,
  featureIconCompact: {
    width: 22,
    height: 22,
    borderRadius: borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  } as const,
};
