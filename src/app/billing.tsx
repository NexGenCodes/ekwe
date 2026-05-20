import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { Check, X, Crown, Sparkles, Zap } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { BILLING_PLANS } from '@/constants/billing';
import type { PlanFeature } from '@/constants/billing';
import { useTheme } from '@/hooks';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';

// ─── Feature Row ────────────────────────────────────────────────────────────

function FeatureRow({
  feature,
  accentColor,
  mutedColor,
  textColor,
}: {
  feature: PlanFeature;
  accentColor: string;
  mutedColor: string;
  textColor: string;
}): React.JSX.Element {
  return (
    <View style={styles.featureRow}>
      {feature.included ? (
        <View
          style={[styles.featureIcon, { backgroundColor: `${accentColor}1A` }]}
        >
          <Check size={14} color={accentColor} strokeWidth={3} />
        </View>
      ) : (
        <View
          style={[styles.featureIcon, { backgroundColor: `${mutedColor}15` }]}
        >
          <X size={14} color={mutedColor} strokeWidth={2} />
        </View>
      )}
      <Text
        style={[
          styles.featureText,
          { color: feature.included ? textColor : mutedColor },
        ]}
      >
        {feature.title}
      </Text>
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function BillingScreen(): React.ReactElement {
  const { color, isDark } = useTheme();
  const isPro = useSelector(() => auth$.isPro.get());

  const handleUpgrade = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    AppAlert.info(
      'Ekwe Pro',
      'Premium subscriptions are currently being rolled out. Check back soon!',
    );
  };

  const handleManage = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
          <View
            style={[
              styles.heroGradient,
              {
                backgroundColor: isDark
                  ? `${color.primary}15`
                  : `${color.primary}0A`,
              },
            ]}
          >
            <View
              style={[
                styles.heroIconContainer,
                { backgroundColor: `${color.primary}20` },
              ]}
            >
              {isPro ? (
                <Crown size={28} color={color.primary} />
              ) : (
                <Sparkles size={28} color={color.primary} />
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
          </View>
        </Animated.View>

        {/* ── Billing Toggle ── */}
        {!isPro && (
          <Animated.View
            entering={FadeInDown.delay(150).duration(400)}
            style={styles.toggleContainer}
          >
            <Pressable
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsAnnual(false);
              }}
              style={[
                styles.toggleOption,
                !isAnnual && { backgroundColor: color.secondary },
              ]}
            >
              <Text
                style={[
                  styles.toggleOptionText,
                  { color: !isAnnual ? color.foreground : color.muted },
                ]}
              >
                Monthly
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsAnnual(true);
              }}
              style={[
                styles.toggleOption,
                isAnnual && { backgroundColor: color.secondary },
              ]}
            >
              <Text
                style={[
                  styles.toggleOptionText,
                  { color: isAnnual ? color.foreground : color.muted },
                ]}
              >
                Annual
              </Text>
              {isAnnual && (
                <View style={styles.savingsBadge}>
                  <Text style={styles.savingsBadgeText}>
                    Save {proPlan.annualSavingPercent}%
                  </Text>
                </View>
              )}
            </Pressable>
          </Animated.View>
        )}

        {/* ── Plan Cards ── */}
        <View style={styles.plansContainer}>
          {/* Free Plan */}
          <Animated.View
            entering={FadeInUp.delay(200).duration(500)}
            style={[
              styles.planCard,
              {
                backgroundColor: color.card,
                borderColor: !isPro ? color.primary : color.border,
                borderWidth: !isPro ? 2 : 1,
              },
            ]}
          >
            {!isPro && (
              <View
                style={[
                  styles.currentBadge,
                  { backgroundColor: color.secondary },
                ]}
              >
                <Text style={styles.currentBadgeText}>Current</Text>
              </View>
            )}
            <Text style={[styles.planName, { color: color.foreground }]}>
              {freePlan.name}
            </Text>
            <View style={styles.priceRow}>
              <Text style={[styles.priceAmount, { color: color.foreground }]}>
                Free
              </Text>
            </View>
            <Text style={[styles.planTagline, { color: color.muted }]}>
              {freePlan.tagline}
            </Text>

            <View style={styles.divider} />

            {freePlan.features.map((f) => (
              <FeatureRow
                key={f.title}
                feature={f}
                accentColor={color.primary}
                mutedColor={color.muted}
                textColor={color.foreground}
              />
            ))}
          </Animated.View>

          {/* Pro Plan */}
          <Animated.View
            entering={FadeInUp.delay(300).duration(500)}
            style={[
              styles.planCard,
              {
                backgroundColor: color.card,
                borderColor: isPro ? color.primary : color.border,
                borderWidth: isPro ? 2 : 1,
              },
            ]}
          >
            {isPro && (
              <View
                style={[
                  styles.currentBadge,
                  { backgroundColor: color.primary },
                ]}
              >
                <Text style={styles.currentBadgeText}>Active</Text>
              </View>
            )}
            <View style={styles.proHeader}>
              <Text style={[styles.planName, { color: color.foreground }]}>
                {proPlan.name}
              </Text>
              <Zap size={18} color={color.primary} />
            </View>
            <View style={styles.priceRow}>
              <Text style={[styles.priceCurrency, { color: color.muted }]}>
                {proPlan.fallbackPriceMonthly.symbol}
              </Text>
              <Text style={[styles.priceAmount, { color: color.foreground }]}>
                {currentPrice.toFixed(2)}
              </Text>
              <Text style={[styles.pricePeriod, { color: color.muted }]}>
                /month
              </Text>
            </View>
            {isAnnual && (
              <Text style={[styles.annualNote, { color: color.primary }]}>
                Billed {proPlan.fallbackPriceAnnual.symbol}
                {proPlan.fallbackPriceAnnual.amount}/year — save{' '}
                {proPlan.annualSavingPercent}%
              </Text>
            )}
            <Text style={[styles.planTagline, { color: color.muted }]}>
              {proPlan.tagline}
            </Text>

            <View style={styles.divider} />

            {proPlan.features.map((f) => (
              <FeatureRow
                key={f.title}
                feature={{ ...f, included: true }}
                accentColor={color.primary}
                mutedColor={color.muted}
                textColor={color.foreground}
              />
            ))}

            {/* CTA */}
            {!isPro ? (
              <Pressable
                onPress={handleUpgrade}
                style={({ pressed }) => [
                  styles.ctaButton,
                  { backgroundColor: color.primary },
                  pressed && styles.ctaPressed,
                ]}
              >
                <Crown
                  size={18}
                  color={color.onPrimary}
                  style={{ marginRight: 8 }}
                />
                <Text style={[styles.ctaText, { color: color.onPrimary }]}>
                  Upgrade to Pro
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleManage}
                style={({ pressed }) => [
                  styles.manageButton,
                  {
                    borderColor: color.border,
                  },
                  pressed && styles.ctaPressed,
                ]}
              >
                <Text style={[styles.manageText, { color: color.foreground }]}>
                  Manage Subscription
                </Text>
              </Pressable>
            )}
          </Animated.View>
        </View>

        {/* ── Footer ── */}
        <Animated.View
          entering={FadeInUp.delay(400).duration(400)}
          style={styles.footer}
        >
          <Text style={[styles.footerText, { color: color.muted }]}>
            Subscriptions are managed through your App Store or Google Play
            account. Cancel anytime.
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
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },

  // Hero
  heroBanner: { marginBottom: 24 },
  heroGradient: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
  },
  heroIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontFamily: 'Outfit-Medium',
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontFamily: 'Outfit-Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Toggle
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(128,128,128,0.1)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  toggleOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 11,
    gap: 6,
  },
  toggleOptionText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 14,
  },
  savingsBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  savingsBadgeText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 11,
    color: '#FFFFFF',
  },
  annualNote: {
    fontFamily: 'Outfit-Medium',
    fontSize: 13,
    marginTop: 2,
    marginBottom: 4,
  },

  // Plans
  plansContainer: { gap: 16 },
  planCard: {
    borderRadius: 20,
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  currentBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  currentBadgeText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 11,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  proHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  planName: {
    fontFamily: 'Outfit-Medium',
    fontSize: 22,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 8,
  },
  priceCurrency: {
    fontFamily: 'Outfit-Medium',
    fontSize: 18,
    marginRight: 2,
  },
  priceAmount: {
    fontFamily: 'Outfit-Medium',
    fontSize: 36,
    letterSpacing: -1,
  },
  pricePeriod: {
    fontFamily: 'Outfit-Regular',
    fontSize: 14,
    marginLeft: 4,
  },
  planTagline: {
    fontFamily: 'Outfit-Regular',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
    marginVertical: 16,
  },

  // Features
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  featureIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 15,
  },

  // CTA
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 20,
  },
  ctaText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 16,
    color: '#FFFFFF',
  },
  ctaPressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  manageButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 20,
  },
  manageText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 15,
  },

  // Footer
  footer: { paddingVertical: 24, alignItems: 'center' },
  footerText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    opacity: 0.6,
  },
});
