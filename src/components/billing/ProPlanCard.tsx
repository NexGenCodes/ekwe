import { Check, Zap } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { useSelector } from '@legendapp/state/react';

import { FeatureRow } from './FeatureRow';

import { Button } from '@/components/Button';
import { Box, Text } from '@/components/ui';
import { DISPLAY_PRICING } from '@/constants/billing';
import type { BILLING_PLANS, PlanFeature } from '@/constants/billing';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import type { ThemeTokens } from '@/hooks/ui/useTheme';
import { settings$ } from '@/store';

interface PriceBreakdown {
  displayPrice: number;
  originalPrice: number;
  symbol: string;
  annualTotal: number;
  savingPercent: number;
}

function usePriceBreakdown(
  plan: (typeof BILLING_PLANS)['pro'],
  isAnnual: boolean,
): PriceBreakdown {
  const currency = useSelector(() => settings$.currency.get());

  return useMemo(() => {
    const activePricing = DISPLAY_PRICING[currency] || DISPLAY_PRICING.USD;
    const monthlyPrice = activePricing.monthly.amount;
    const symbol = activePricing.monthly.symbol;

    if (!isAnnual) {
      return {
        displayPrice: monthlyPrice,
        originalPrice: monthlyPrice,
        symbol,
        annualTotal: 0,
        savingPercent: 0,
      };
    }

    const annualTotal = activePricing.annual.amount;
    const effectiveMonthly = activePricing.annualMonthlyCost;
    const savingPercent = activePricing.annualSavingPercent;

    return {
      displayPrice: effectiveMonthly,
      originalPrice: monthlyPrice,
      symbol,
      annualTotal,
      savingPercent,
    };
  }, [currency, isAnnual]);
}

export interface ProPlanCardProps {
  isPro: boolean;
  isAnnual: boolean;
  color: ThemeTokens['color'];
  isDark: boolean;
  proPlan: (typeof BILLING_PLANS)['pro'];
  handleUpgrade: () => Promise<void>;
  handleManage: () => Promise<void>;
}

export function ProPlanCard({
  isPro,
  isAnnual,
  color,
  isDark,
  proPlan,
  handleUpgrade,
  handleManage,
}: ProPlanCardProps): React.JSX.Element {
  const glassBg = isDark ? color.card : color.background;
  const dividerBg = color.border;
  const price = usePriceBreakdown(proPlan, isAnnual);

  return (
    <Box
      style={[
        styles.planCard,
        styles.proCard,
        {
          backgroundColor: glassBg,
          borderColor: color.secondary,
          borderWidth: 2,
          shadowColor: color.secondary,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.15,
          shadowRadius: 20,
          elevation: 3,
        },
      ]}
    >
      {isPro && (
        <Box
          style={[
            styles.currentBadge,
            {
              backgroundColor: color.secondary,
              shadowColor: color.secondary,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 4,
              elevation: 1,
            }
          ]}
        >
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Check size={12} color={color.background} strokeWidth={2} />
            <Text variant="caption" style={{ color: color.background, fontWeight: '600' }}>
              Active Plan
            </Text>
          </Box>
        </Box>
      )}
      <Box style={styles.proHeader}>
        <Text variant="heading2" style={{ color: color.foreground }}>
          {proPlan.name}
        </Text>
        <Zap size={20} color={color.secondary} fill={color.secondary} />
      </Box>

      <Box style={styles.priceRow}>
        {isAnnual && (
          <Text
            variant="body"
            style={[
              styles.strikethrough,
              { color: color.muted, textDecorationLine: 'line-through' },
            ]}
          >
            {price.symbol}{price.originalPrice.toFixed(2)}
          </Text>
        )}
        <Text variant="body" style={{ color: color.secondary }}>
          {price.symbol}
        </Text>
        <Text variant="heading1" style={{ color: color.foreground }}>
          {price.displayPrice.toFixed(2)}
        </Text>
        <Text variant="body" style={{ color: color.muted }}>
          / month
        </Text>
      </Box>

      {isAnnual && (
        <Box style={styles.annualRow}>
          <Box style={[styles.savingChip, { backgroundColor: color.success }]}>
            <Text variant="caption" style={{ color: color.background, fontWeight: '800' }}>
              Save {price.savingPercent}%
            </Text>
          </Box>
          <Text variant="body" style={{ color: color.secondary }}>
            Billed {price.symbol}{price.annualTotal.toFixed(2)} annually
          </Text>
        </Box>
      )}

      <Text variant="bodySmall" style={{ color: color.foreground }}>
        {proPlan.tagline}
      </Text>

      <Box style={[styles.divider, { backgroundColor: dividerBg }]} />
      {proPlan.features.map((f: PlanFeature, index: number) => (
        <React.Fragment key={f.title}>
          <FeatureRow
            feature={{ ...f, included: true }}
            accentColor={color.secondary}
            mutedColor={color.muted}
            textColor={color.foreground}
            isPro
          />
          {index < proPlan.features.length - 1 && (
            <Box style={{ height: 1, backgroundColor: color.border, opacity: 0.15, marginVertical: spacing.xs }} />
          )}
        </React.Fragment>
      ))}
      <Box style={styles.ctaContainer}>
        <Button
          label={isPro ? "Manage Subscription" : "Go Pro"}
          variant="secondary"
          onPress={isPro ? handleManage : handleUpgrade}
          size="large"
        />
      </Box>
    </Box>
  );
}

const styles = {
  planCard: {
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing.lg,
    position: 'relative',
    overflow: 'hidden',
  } as const,
  proCard: {
    paddingVertical: spacing['2xl'],
  } as const,
  currentBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    borderBottomLeftRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  } as const,
  proHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  } as const,
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  } as const,
  strikethrough: {
    fontSize: 16,
    lineHeight: 28,
    textDecorationLine: 'line-through',
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
    transform: [{ rotate: '-6deg' }],
  } as const,
  annualRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  } as const,
};
