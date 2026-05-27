import React from 'react';

import { FeatureRow } from './FeatureRow';

import { Box, Text } from '@/components/ui';
import type { BILLING_PLANS, PlanFeature } from '@/constants/billing';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import type { ThemeTokens } from '@/hooks/ui/useTheme';

export interface FreePlanCardProps {
  isPro: boolean;
  color: ThemeTokens['color'];
  isDark: boolean;
  freePlan: (typeof BILLING_PLANS)['free'];
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
      <Box style={styles.priceRow}>
        <Text variant="heading1" style={{ color: color.foreground }}>
          Free
        </Text>
      </Box>
      <Text
        variant="bodySmall"
        style={{
          marginTop: spacing.xs,
          marginBottom: spacing.md,
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
        />
      ))}
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  } as const,
  divider: {
    height: 1,
    marginVertical: spacing.lg,
  } as const,
};
