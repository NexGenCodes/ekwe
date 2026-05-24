import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { Check, X, Crown, Sparkles, Zap } from 'lucide-react-native';
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BILLING_PLANS } from '@/constants/billing';
import type { PlanFeature } from '@/constants/billing';
import { borderRadius, spacing, typography } from '@/constants/designTokens';
import type { ThemeTokens } from '@/hooks/ui/useTheme';
import { useTheme } from '@/hooks';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';
import { GradientMesh } from '@/components/ui/GradientMesh';
import { Button } from '@/components/ui/Button';

// ─── Feature Row ────────────────────────────────────────────────────────────

function FeatureRow({
  feature,
  accentColor,
  mutedColor,
  textColor,
  isPro,
}: {
  feature: PlanFeature;
  accentColor: string;
  mutedColor: string;
  textColor: string;
  isPro: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.featureRow}>
      {feature.included ? (
        <View
          style={[
            styles.featureIcon,
            { backgroundColor: isPro ? `${accentColor}25` : `${accentColor}15` },
          ]}
        >
          <Check size={14} color={accentColor} strokeWidth={3.5} />
        </View>
      ) : (
        <View style={[styles.featureIcon, { backgroundColor: `${mutedColor}15` }]}>
          <X size={14} color={mutedColor} strokeWidth={2.5} />
        </View>
      )}
      <Text
        style={[
          styles.featureText,
          { color: feature.included ? textColor : mutedColor },
          feature.included && { fontFamily: 'Outfit-Medium' },
        ]}
      >
        {feature.title}
      </Text>
    </View>
  );
}

// ─── Sliding Toggle ─────────────────────────────────────────────────────────

function BillingToggle({
  isAnnual,
  onToggle,
  color,
}: {
  isAnnual: boolean;
  onToggle: (annual: boolean) => void;
  color: ThemeTokens['color'];
}) {
  const slideAnim = useSharedValue(isAnnual ? 1 : 0);

  useEffect(() => {
    slideAnim.value = withTiming(isAnnual ? 1 : 0, {
      duration: 250,
    });
  }, [isAnnual, slideAnim]);

  const indicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: slideAnim.value * 150 }], // 150 is half of 300
    };
  });

  return (
    <View style={[styles.toggleContainer, { backgroundColor: color.surface }]}>
      <Animated.View
        style={[
          styles.toggleIndicator,
          { backgroundColor: color.primary },
          indicatorStyle,
        ]}
      />
      <Pressable
        onPress={() => onToggle(false)}
        style={styles.toggleOption}
        hitSlop={10}
      >
        <Text
          style={[
            styles.toggleOptionText,
            { color: !isAnnual ? color.onPrimary : color.foreground },
          ]}
        >
          Monthly
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onToggle(true)}
        style={styles.toggleOption}
        hitSlop={10}
      >
        <Text
          style={[
            styles.toggleOptionText,
            { color: isAnnual ? color.onPrimary : color.foreground },
          ]}
        >
          Annual
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Plan Cards ─────────────────────────────────────────────────────────────

function ProPlanCard({
  isPro,
  isAnnual,
  color,
  isDark,
  proPlan,
  currentPrice,
  handleUpgrade,
  handleManage,
}: {
  isPro: boolean;
  isAnnual: boolean;
  color: ThemeTokens['color'];
  isDark: boolean;
  proPlan: (typeof BILLING_PLANS)['pro'];
  currentPrice: number;
  handleUpgrade: () => Promise<void>;
  handleManage: () => Promise<void>;
}) {
  const glassBg = isDark ? color.card : color.background;
  const dividerBg = color.border;

  return (
    <Animated.View
      entering={FadeInUp.delay(250).duration(500)}
      style={[
        styles.planCard,
        styles.proCard,
        {
          backgroundColor: glassBg,
          borderColor: color.primary,
          borderWidth: 2,
          shadowColor: color.warning,
        },
      ]}
    >
      {isPro && (
        <View style={[styles.currentBadge, { backgroundColor: color.primary }]}>
          <Text style={[styles.currentBadgeText, { color: color.background }]}>Active Plan</Text>
        </View>
      )}
      <View style={styles.proHeader}>
        <Text style={[styles.planName, { color: color.foreground }]}>
          {proPlan.name}
        </Text>
        <Zap size={20} color={color.primary} fill={color.primary} />
      </View>
      <View style={styles.priceRow}>
        <Text style={[styles.priceCurrency, { color: color.foreground }]}>
          {proPlan.fallbackPriceMonthly.symbol}
        </Text>
        <Text style={[styles.priceAmount, { color: color.foreground }]}>
          {currentPrice.toFixed(2)}
        </Text>
        <Text style={[styles.pricePeriod, { color: color.muted }]}>
          / month
        </Text>
      </View>
      {isAnnual && (
        <Text style={[styles.annualNote, { color: color.primary }]}>
          Billed {proPlan.fallbackPriceAnnual.symbol}
          {proPlan.fallbackPriceAnnual.amount} annually
        </Text>
      )}
      <Text style={[styles.planTagline, { color: color.foreground }]}>
        {proPlan.tagline}
      </Text>

      <View style={[styles.divider, { backgroundColor: dividerBg }]} />

      {proPlan.features.map((f: PlanFeature) => (
        <FeatureRow
          key={f.title}
          feature={{ ...f, included: true }}
          accentColor={color.primary}
          mutedColor={color.muted}
          textColor={color.foreground}
          isPro={true}
        />
      ))}

      <View style={styles.ctaContainer}>
        {!isPro ? (
          <Button
            label="Start Pro Trial"
            onPress={handleUpgrade}
            size="large"
            leftIcon={<Crown size={18} color={color.onPrimary} />}
          />
        ) : (
          <Button
            label="Manage Subscription"
            variant="outline"
            onPress={handleManage}
            size="large"
          />
        )}
      </View>
    </Animated.View>
  );
}

function FreePlanCard({
  isPro,
  color,
  isDark,
  freePlan,
}: {
  isPro: boolean;
  color: ThemeTokens['color'];
  isDark: boolean;
  freePlan: (typeof BILLING_PLANS)['free'];
}) {
  if (isPro) return null;

  const bg = isDark ? color.card : color.background;
  const dividerBg = color.border;

  return (
    <Animated.View
      entering={FadeInUp.delay(350).duration(500)}
      style={[
        styles.planCard,
        {
          backgroundColor: bg,
          borderColor: color.border,
          borderWidth: 1,
          paddingVertical: spacing[6],
        },
      ]}
    >
      <Text style={[styles.planName, { color: color.foreground }]}>
        {freePlan.name}
      </Text>
      <View style={styles.priceRow}>
        <Text style={[styles.priceAmount, { color: color.foreground, fontSize: 36, lineHeight: 40 }]}>
          Free
        </Text>
      </View>
      <Text style={[styles.planTagline, { color: color.muted }]}>
        {freePlan.tagline}
      </Text>

      <View style={[styles.divider, { backgroundColor: dividerBg }]} />

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
    </Animated.View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function BillingScreen(): React.ReactElement {
  const { color, isDark } = useTheme();
  const isPro = useSelector(() => auth$.isPro.get());

  const handleUpgrade = async (): Promise<void> => {
    AppAlert.info(
      'Ekwe Pro',
      'Premium subscriptions are currently being rolled out. Check back soon!',
    );
  };

  const handleManage = async (): Promise<void> => {
    AppAlert.info(
      'Manage Subscription',
      'You can manage your subscription from your device settings.',
    );
  };

  const [isAnnual, setIsAnnual] = useState(true);

  const freePlan = BILLING_PLANS.free;
  const proPlan = BILLING_PLANS.pro;
  const currentPrice = isAnnual
    ? proPlan.annualMonthlyCost
    : proPlan.fallbackPriceMonthly.amount;

  return (
    <View style={[styles.flex1, { backgroundColor: color.background }]}>
      <GradientMesh />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── Hero Banner ── */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={styles.heroBanner}
        >
          <View style={[styles.heroIconContainer, { backgroundColor: color.background }]}>
            {isPro ? (
              <Crown size={32} color={color.primary} strokeWidth={2.5} />
            ) : (
              <Sparkles size={32} color={color.primary} strokeWidth={2.5} />
            )}
          </View>
          <Text style={[styles.heroTitle, { color: color.foreground }]}>
            {isPro ? `You're on Ekwe Pro` : 'Unlock the full experience'}
          </Text>
          <Text style={[styles.heroSubtitle, { color: color.muted }]}>
            {isPro
              ? 'You have access to all premium features and an ad-free experience.'
              : 'Go Pro for an ad-free, distraction-free translation experience with premium voices and offline packs.'}
          </Text>
        </Animated.View>

        {/* ── Billing Toggle ── */}
        {!isPro && (
          <Animated.View
            entering={FadeInDown.delay(150).duration(400)}
            style={styles.toggleWrapper}
          >
            <BillingToggle
              isAnnual={isAnnual}
              onToggle={async (annual) => {
                await Haptics.selectionAsync();
                setIsAnnual(annual);
              }}
              color={color}
            />
            {isAnnual && (
              <Animated.View entering={FadeInUp.duration(300)} style={[styles.savingsBadge, { backgroundColor: color.success }]}>
                <Text style={[styles.savingsBadgeText, { color: color.background }]}>
                  Save {proPlan.annualSavingPercent}%
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        )}

        {/* ── Plan Cards ── */}
        <View style={styles.plansContainer}>
          <ProPlanCard
            isPro={isPro}
            isAnnual={isAnnual}
            color={color}
            isDark={isDark}
            proPlan={proPlan}
            currentPrice={currentPrice}
            handleUpgrade={handleUpgrade}
            handleManage={handleManage}
          />
          <FreePlanCard
            isPro={isPro}
            color={color}
            isDark={isDark}
            freePlan={freePlan}
          />
        </View>

        {/* ── Footer ── */}
        <Animated.View
          entering={FadeInUp.delay(450).duration(400)}
          style={styles.footer}
        >
          <Text style={[styles.footerText, { color: color.muted }]}>
            Subscriptions are managed through your device's App Store. You can cancel anytime from your settings.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[12] },

  // Hero
  heroBanner: {
    alignItems: 'center',
    paddingVertical: spacing[8],
  },
  heroIconContainer: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  heroTitle: {
    fontFamily: 'DMSerifDisplay-Regular',
    fontSize: 34,
    textAlign: 'center',
    marginBottom: spacing[3],
    letterSpacing: 0.5,
  },
  heroSubtitle: {
    fontFamily: 'Outfit-Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing[4],
  },

  // Toggle
  toggleWrapper: {
    alignItems: 'center',
    marginBottom: spacing[8],
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: borderRadius.full,
    padding: 4,
    width: 308, // 150 * 2 + 8
    position: 'relative',
  },
  toggleIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 150,
    height: '100%',
    borderRadius: borderRadius.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  toggleOption: {
    width: 150,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    zIndex: 1,
  },
  toggleOptionText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  savingsBadge: {
    position: 'absolute',
    top: -12,
    right: 20,
    backgroundColor: '#10B981', // Emerald green for savings
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    transform: [{ rotate: '4deg' }],
  },
  savingsBadgeText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
  },

  // Plans
  plansContainer: { gap: spacing[6] },
  planCard: {
    borderRadius: 32,
    paddingHorizontal: spacing[6],
    position: 'relative',
    overflow: 'hidden',
  },
  proCard: {
    paddingVertical: spacing[8],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  currentBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    borderBottomLeftRadius: 16,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  currentBadgeText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  proHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  planName: {
    fontFamily: 'Outfit-Bold',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing[3],
    marginBottom: spacing[1],
  },
  priceCurrency: {
    fontFamily: 'Outfit-Bold',
    fontSize: 20,
    marginTop: 4,
    marginRight: 2,
  },
  priceAmount: {
    fontFamily: 'Outfit-Bold',
    fontSize: 48,
    letterSpacing: -1.5,
    lineHeight: 52,
  },
  pricePeriod: {
    fontFamily: 'Outfit-Medium',
    fontSize: 14,
    alignSelf: 'flex-end',
    marginBottom: 8,
    marginLeft: spacing[1],
  },
  annualNote: {
    fontFamily: 'Outfit-Medium',
    fontSize: 13,
    marginBottom: spacing[2],
  },
  planTagline: {
    fontFamily: 'Outfit-Regular',
    fontSize: 14,
    marginTop: spacing[1],
    marginBottom: spacing[4],
  },
  divider: {
    height: 1,
    marginVertical: spacing[5],
  },

  // Features
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[4],
  },
  featureText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 15,
    flex: 1,
  },

  // CTA container
  ctaContainer: {
    marginTop: spacing[8],
  },

  // Footer
  footer: {
    paddingVertical: spacing[8],
    alignItems: 'center',
    paddingHorizontal: spacing[8],
  },
  footerText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
