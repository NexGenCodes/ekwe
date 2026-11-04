import Check from "lucide-react-native/icons/check";
import Sparkles from "lucide-react-native/icons/sparkles";
import Zap from "lucide-react-native/icons/zap";
import React from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { FeatureRow } from "@/components/billing/FeatureRow";

import { Button } from "@/components/Button";
import { SkeletonBox } from "@/components/SkeletonBox";
import { Box, Text } from "@/components/ui";
import type { BILLING_PLANS, PlanFeature } from "@/constants/billing";
import { duration } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useActivePricing } from "@/hooks/billing/useActivePricing";
import { formatAmount } from "@ekwe/shared/money";
import type { ThemeTokens } from "@/hooks/ui/useTheme";
import { withAlpha } from "@/utils/color";

export interface PaidPlanCardProps {
  isPro: boolean;
  isAnnual: boolean;
  loading: boolean;
  color: ThemeTokens["color"];
  isDark: boolean;
  paidPlan: (typeof BILLING_PLANS)["pro"];
  handleUpgrade: () => Promise<void>;
  handleRestore: () => Promise<void>;
}

export function PaidPlanCard({
  isPro,
  isAnnual,
  loading,
  color,
  isDark,
  paidPlan,
  handleUpgrade,
  handleRestore,
}: PaidPlanCardProps): React.JSX.Element {
  const glassBg = isDark ? color.card : color.background;
  const dividerBg = color.border;
  const { pricing, isPending } = useActivePricing();

  const displayAmount = isAnnual
    ? pricing.annualMonthlyCost
    : pricing.monthlyAmount;
  const priceKey = `${pricing.currency}-${isAnnual}-${displayAmount}`;

  return (
    <Box
      style={[
        styles.planCard,
        styles.paidCard,
        {
          backgroundColor: glassBg,
          borderColor: color.brand,
          borderWidth: 1.5,
          shadowColor: color.brand,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: isDark ? 0.18 : 0.1,
          shadowRadius: 20,
          elevation: isDark ? 4 : 3,
        },
      ]}
    >
      <Box
        pointerEvents="none"
        style={[
          styles.fill,
          { backgroundColor: withAlpha(color.brand, isDark ? 0.05 : 0.035) },
        ]}
      />
      <Box
        style={[
          styles.topBadge,
          {
            backgroundColor: color.brand,
            shadowColor: color.brand,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 6,
            elevation: 2,
          },
        ]}
      >
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
          }}
        >
          {isPro ? (
            <Check size={12} color={color.onBrand} strokeWidth={3} />
          ) : (
            <Sparkles size={12} color={color.onBrand} strokeWidth={2.5} />
          )}
          <Text
            variant="caption"
            style={{ color: color.onBrand, fontWeight: "700" }}
          >
            {isPro ? "Active Plan" : "Recommended"}
          </Text>
        </Box>
      </Box>

      <Box style={styles.proHeader}>
        <Box
          style={[
            styles.planIcon,
            { backgroundColor: withAlpha(color.brand, 0.12) },
          ]}
        >
          <Zap size={18} color={color.brand} fill={color.brand} />
        </Box>
        <Box style={styles.proTitleBlock}>
          <Text variant="heading2" style={{ color: color.foreground }}>
            {paidPlan.name}
          </Text>
          <Text variant="bodySmall" style={{ color: color.muted }}>
            {paidPlan.tagline}
          </Text>
        </Box>
      </Box>

      <Box style={styles.priceBlock}>
        {isPending ? (
          <Box
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading prices"
          >
            {isAnnual && (
              <Box style={styles.annualNoteRow}>
                <SkeletonBox
                  width={96}
                  height={14}
                  borderRadius={borderRadius.md}
                />
                <SkeletonBox
                  width={64}
                  height={22}
                  borderRadius={borderRadius.full}
                />
              </Box>
            )}
            <SkeletonBox
              width={188}
              height={34}
              borderRadius={borderRadius.md}
              style={styles.priceSkeleton}
            />
            {isAnnual && (
              <SkeletonBox
                width={168}
                height={14}
                borderRadius={borderRadius.md}
              />
            )}
          </Box>
        ) : (
          <>
            {isAnnual && (
              <Box style={styles.annualNoteRow}>
                <Text
                  variant="bodySmall"
                  style={[
                    styles.strikethrough,
                    { color: color.muted, textDecorationLine: "line-through" },
                  ]}
                >
                  {pricing.symbol}
                  {formatAmount(pricing.monthlyAmount, pricing.currency)}/mo
                </Text>
                <Box
                  style={[
                    styles.savingChip,
                    { backgroundColor: color.success },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{ color: color.onBrand, fontWeight: "800" }}
                  >
                    Save {pricing.annualSavingPercent}%
                  </Text>
                </Box>
              </Box>
            )}
            <Box style={styles.priceRow}>
              <Text variant="heading1" style={{ color: color.brand }}>
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
              <Text
                variant="body"
                style={[styles.priceSuffix, { color: color.muted }]}
              >
                {isAnnual ? "/ month" : "/ 30 days"}
              </Text>
            </Box>
            <Text variant="bodySmall" style={{ color: color.brand }}>
              {isAnnual
                ? `One-time payment of ${pricing.symbol}${formatAmount(
                    pricing.annualAmount,
                    pricing.currency,
                  )} for 12 months`
                : "One-time payment for 30 days"}
            </Text>
            <Text
              variant="caption"
              style={{ color: color.muted, letterSpacing: 0.3 }}
            >
              Prices shown in {pricing.currency} · No auto-renewal
            </Text>
          </>
        )}
      </Box>

      <Box style={[styles.divider, { backgroundColor: dividerBg }]} />
      {paidPlan.features.map((f: PlanFeature) => (
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
          label={isPro ? "Check Plan Status" : "Upgrade"}
          variant={isPro ? "outline" : "primary"}
          onPress={isPro ? handleRestore : handleUpgrade}
          size="large"
          loading={loading}
          disabled={loading || isPending}
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
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as const,
  paidCard: {
    paddingVertical: spacing.xl,
  } as const,
  topBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    borderBottomLeftRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  } as const,
  proHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  } as const,
  planIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
  } as const,
  proTitleBlock: {
    gap: spacing.hairline,
  } as const,
  priceBlock: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  } as const,
  annualNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  } as const,
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xs,
  } as const,
  priceSuffix: {
    marginBottom: spacing.xs,
  } as const,
  priceSkeleton: {
    marginTop: spacing.sm,
  } as const,
  strikethrough: {
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: "line-through",
  } as const,
  savingChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  } as const,
  divider: {
    height: 1,
    marginVertical: spacing.md,
  } as const,
  ctaContainer: {
    marginTop: spacing.lg,
  } as const,
};
