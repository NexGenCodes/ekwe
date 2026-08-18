import Check from "lucide-react-native/icons/check";
import Zap from "lucide-react-native/icons/zap";
import React from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { FeatureRow } from "./FeatureRow";

import { Button } from "@/components/Button";
import { Box, Text } from "@/components/ui";
import type { BILLING_PLANS, PlanFeature } from "@/constants/billing";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { duration } from "@/constants";
import { useActivePricing } from "@/hooks/billing/useActivePricing";
import { getDecimals } from "@ekwe/shared/money";
import type { ThemeTokens } from "@/hooks/ui/useTheme";

export interface ProPlanCardProps {
  isPro: boolean;
  isAnnual: boolean;
  loading: boolean;
  color: ThemeTokens["color"];
  isDark: boolean;
  proPlan: (typeof BILLING_PLANS)["pro"];
  handleUpgrade: () => Promise<void>;
  handleManage: () => Promise<void>;
}

/**
 * Formats a currency amount with the per-currency decimal places (e.g. XOF
 * has 0) and thousands grouping. Keeps precision consistent with the money
 * helpers in @ekwe/shared/{money,currencies}.
 */
function formatAmount(amount: number, code: string): string {
  const decimals = getDecimals(code);
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function ProPlanCard({
  isPro,
  isAnnual,
  loading,
  color,
  isDark,
  proPlan,
  handleUpgrade,
  handleManage,
}: ProPlanCardProps): React.JSX.Element {
  const glassBg = isDark ? color.card : color.background;
  const dividerBg = color.border;
  const { pricing } = useActivePricing();

  const displayAmount = isAnnual
    ? pricing.annualMonthlyCost
    : pricing.monthlyAmount;
  const priceKey = `${pricing.currency}-${isAnnual}-${displayAmount}`;

  return (
    <Box
      style={[
        styles.planCard,
        styles.proCard,
        {
          backgroundColor: glassBg,
          borderColor: color.brand,
          borderWidth: 1,
          shadowColor: color.brand,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 2,
        },
      ]}
    >
      {isPro && (
        <Box
          style={[
            styles.currentBadge,
            {
              backgroundColor: color.brand,
              shadowColor: color.brand,
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.12,
              shadowRadius: 3,
              elevation: 1,
            },
          ]}
        >
          <Box style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Check size={12} color={color.background} strokeWidth={2} />
            <Text
              variant="caption"
              style={{ color: color.background, fontWeight: "600" }}
            >
              Active Plan
            </Text>
          </Box>
        </Box>
      )}
      <Box style={styles.proHeader}>
        <Text variant="heading2" style={{ color: color.foreground }}>
          {proPlan.name}
        </Text>
        <Zap size={20} color={color.brand} fill={color.brand} />
      </Box>

      <Box style={styles.priceRow}>
        {isAnnual && (
          <Text
            variant="body"
            style={[
              styles.strikethrough,
              { color: color.muted, textDecorationLine: "line-through" },
            ]}
          >
            {pricing.symbol}
            {formatAmount(pricing.monthlyAmount, pricing.currency)}
          </Text>
        )}
        <Text variant="body" style={{ color: color.brand }}>
          {pricing.symbol}
        </Text>
        <Animated.View
          key={priceKey}
          entering={FadeIn.duration(duration.normal)}
        >
          <Text variant="heading1" style={{ color: color.foreground }}>
            {formatAmount(displayAmount, pricing.currency)}
          </Text>
        </Animated.View>
        <Text variant="body" style={{ color: color.muted }}>
          / month
        </Text>
      </Box>

      {isAnnual && (
        <Box style={styles.annualRow}>
          <Box style={[styles.savingChip, { backgroundColor: color.success }]}>
            <Text
              variant="caption"
              style={{ color: color.background, fontWeight: "800" }}
            >
              Save {pricing.annualSavingPercent}%
            </Text>
          </Box>
          <Text variant="body" style={{ color: color.brand }}>
            {`Billed ${pricing.symbol}${formatAmount(pricing.annualAmount, pricing.currency)} annually`}
          </Text>
        </Box>
      )}

      <Text variant="bodySmall" style={{ color: color.foreground }}>
        {proPlan.tagline}
      </Text>

      <Box style={[styles.divider, { backgroundColor: dividerBg }]} />
      {proPlan.features.map((f: PlanFeature) => (
        <FeatureRow
          key={f.title}
          feature={{ ...f, included: true }}
          accentColor={color.brand}
          mutedColor={color.muted}
          textColor={color.foreground}
          isPro
          compact
        />
      ))}
      <Box style={styles.ctaContainer}>
        <Button
          label={isPro ? "Manage Subscription" : "Go Pro"}
          variant="outline"
          onPress={isPro ? handleManage : handleUpgrade}
          size="large"
          loading={loading}
          disabled={loading}
        />
      </Box>
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
  proCard: {
    paddingVertical: spacing.xl,
  } as const,
  currentBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    borderBottomLeftRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  } as const,
  proHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  } as const,
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  } as const,
  strikethrough: {
    fontSize: 16,
    lineHeight: 28,
    textDecorationLine: "line-through",
  } as const,
  divider: {
    height: 1,
    marginVertical: spacing.lg,
  } as const,
  ctaContainer: {
    marginTop: spacing.xl,
  } as const,
  savingChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    transform: [{ rotate: "-6deg" }],
  } as const,
  annualRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  } as const,
};
