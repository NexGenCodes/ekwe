import { Check, X } from "lucide-react-native";
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
}

export function FeatureRow({
  feature,
  accentColor,
  mutedColor,
  textColor,
  isPro,
}: FeatureRowProps): React.JSX.Element {
  return (
    <Box style={styles.featureRow}>
      {feature.included ? (
        <Box
          style={[
            styles.featureIcon,
            {
              backgroundColor: isPro ? `${accentColor}25` : `${accentColor}15`,
            },
          ]}
        >
          <Check size={14} color={accentColor} strokeWidth={3.5} />
        </Box>
      ) : (
        <Box
          style={[styles.featureIcon, { backgroundColor: `${mutedColor}15` }]}
        >
          <X size={14} color={mutedColor} strokeWidth={2.5} />
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
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  } as const,
};
