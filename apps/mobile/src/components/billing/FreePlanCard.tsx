import React from "react";

import { FeatureRow } from "@/components/billing/FeatureRow";

import { Badge } from "@/components/Badge";
import { Box, Text } from "@/components/ui";
import type { BILLING_PLANS, PlanFeature } from "@/constants/billing";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import type { ThemeTokens } from "@/hooks/ui/useTheme";

export interface FreePlanCardProps {
  isPro: boolean;
  color: ThemeTokens["color"];
  isDark: boolean;
  freePlan: (typeof BILLING_PLANS)["free"];
}

export function FreePlanCard({
  isPro,
  color,
  isDark,
  freePlan,
}: FreePlanCardProps): React.JSX.Element | null {
  if (isPro) return null;

  const bg = isDark ? color.card : color.background;
  const dividerBg = color.border;

  return (
    <Box
      style={[
        styles.planCard,
        {
          backgroundColor: bg,
          borderColor: color.border,
          borderWidth: 1,
          paddingVertical: spacing.lg,
        },
      ]}
    >
      <Box style={styles.cardHeader}>
        <Text variant="heading2" style={{ color: color.foreground }}>
          {freePlan.name}
        </Text>
        <Badge label="Current Plan" variant="muted" size="sm" />
      </Box>
      <Text
        variant="bodySmall"
        style={{
          marginTop: spacing.sm,
          color: color.muted,
        }}
      >
        {freePlan.tagline}
      </Text>

      <Box style={[styles.divider, { backgroundColor: dividerBg }]} />

      {freePlan.features.map((f: PlanFeature) => (
        <FeatureRow
          key={f.title}
          feature={f}
          accentColor={color.foreground}
          mutedColor={color.muted}
          textColor={color.foreground}
          isPro={false}
          compact
        />
      ))}
    </Box>
  );
}

const styles = {
  planCard: {
    borderRadius: borderRadius["2xl"],
    paddingHorizontal: spacing.lg,
    position: "relative",
    overflow: "hidden",
  } as const,
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as const,
  divider: {
    height: 1,
    marginVertical: spacing.md,
  } as const,
};
