import { useSelector } from "@legendapp/state/react";
import { triggerHaptic } from "@/utils/haptics";
import { Stack } from "expo-router";
import Crown from "lucide-react-native/icons/crown";
import Sparkles from "lucide-react-native/icons/sparkles";
import React, { useMemo } from "react";
import Animated, {
  FadeInDown,
  ZoomIn,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import { GradientMesh } from "@/components/GradientMesh";
import { BillingToggle } from "@/components/billing/BillingToggle";
import { CheckoutSheet } from "@/components/billing/CheckoutSheet";
import { FreePlanCard } from "@/components/billing/FreePlanCard";
import { ProPlanCard } from "@/components/billing/ProPlanCard";
import { Box, Text, Pressable, ScrollArea, Spinner } from "@/components/ui";
import { useTheme, useTokens } from "@/hooks";
import { useBilling } from "@/hooks/billing/useBilling";
import { auth$ } from "@/store";

export default function BillingScreen(): React.ReactElement {
  const { color, isDark } = useTheme();
  const tokens = useTokens();
  const { spacing, borderRadius, duration } = tokens;

  const sessionLoaded = useSelector(() => auth$.sessionLoaded.get());
  const email = useSelector(() => auth$.session.get()?.user?.email ?? "");

  const {
    isPro,
    isAnnual,
    setIsAnnual,
    handleUpgrade,
    handleManage,
    handleRestore,
    freePlan,
    proPlan,
    annualSavingPercent,
    loading,
    showCheckout,
    checkoutSession,
    checkoutPlan,
    handleCheckoutComplete,
    handleCheckoutDismiss,
  } = useBilling();

  const styles = useMemo(
    () => ({
      flex1: { flex: 1 } as const,
      centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
      } as const,
      scrollView: { flex: 1 } as const,
      scrollContent: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing["3xl"],
      } as const,

      // Hero
      heroBanner: {
        alignItems: "center",
        paddingVertical: spacing.xl,
      } as const,
      heroIconContainer: {
        width: 80,
        height: 80,
        borderRadius: borderRadius.full,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: spacing.md,
      } as const,
      heroTitle: {
        textAlign: "center",
        marginBottom: spacing.md,
      } as const,
      heroSubtitle: {
        textAlign: "center",
        paddingHorizontal: spacing.md,
      } as const,

      // Toggle
      toggleWrapper: {
        alignItems: "center",
        marginBottom: spacing.xl,
        position: "relative",
      } as const,
      savingsBadgeWrapper: {
        position: "absolute",
        top: -12,
        right: spacing.lg,
      } as const,
      savingsBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        transform: [{ rotate: "-6deg" }],
      } as const,

      // Plans
      plansContainer: { gap: spacing.xl } as const,

      // Footer
      footer: {
        paddingVertical: spacing.xl,
        alignItems: "center",
        paddingHorizontal: spacing.xl,
      } as const,
      footerText: {
        textAlign: "center",
      } as const,
    }),
    [spacing, borderRadius],
  );

  // The billing UI flips between a "Go Pro" and an "Active Plan" state,
  // driven by the auth session. Render a stable placeholder until the
  // session has finished loading so the screen mounts in its final state
  // instead of flickering through both.
  if (!sessionLoaded) {
    return (
      <Box style={[styles.centered, { backgroundColor: color.background }]}>
        <Spinner size="lg" />
      </Box>
    );
  }

  return (
    <Box style={[styles.flex1, { backgroundColor: color.background }]}>
      <Stack.Screen options={{ title: "Billing", headerTitle: "Billing" }} />
      <GradientMesh />
      <ScrollArea
        style={styles.scrollView}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── Hero Banner ── */}
        <Box style={styles.heroBanner}>
          <Animated.View
            entering={ZoomIn.duration(duration.slow)}
            style={[
              styles.heroIconContainer,
              { backgroundColor: color.background },
            ]}
          >
            {isPro ? (
              <Crown size={32} color={color.foreground} strokeWidth={2.5} />
            ) : (
              <Sparkles size={32} color={color.foreground} strokeWidth={2.5} />
            )}
          </Animated.View>
          <Animated.View entering={FadeIn.duration(duration.slow)}>
            <Text
              variant="bodySmall"
              style={[styles.heroSubtitle, { color: color.muted }]}
            >
              {isPro
                ? "You have access to all premium features and an ad-free experience."
                : "Go Pro for an ad-free, distraction-free translation experience with premium voices and offline packs."}
            </Text>
          </Animated.View>
        </Box>

        {/* ── Billing Toggle ── */}
        {!isPro && (
          <Animated.View
            entering={FadeIn.duration(duration.normal)}
            exiting={FadeOut.duration(duration.normal)}
          >
            <Box style={styles.toggleWrapper}>
              <BillingToggle
                isAnnual={isAnnual}
                onToggle={async (annual) => {
                  await triggerHaptic("selection");
                  setIsAnnual(annual);
                }}
                color={color}
              />
              {isAnnual && (
                <Animated.View
                  entering={FadeIn.duration(duration.fast)}
                  exiting={FadeOut.duration(duration.fast)}
                  style={styles.savingsBadgeWrapper}
                >
                  <Box
                    style={[
                      styles.savingsBadge,
                      { backgroundColor: color.success },
                    ]}
                  >
                    <Text variant="caption" style={{ color: color.onBrand }}>
                      Save {annualSavingPercent}%
                    </Text>
                  </Box>
                </Animated.View>
              )}
            </Box>
          </Animated.View>
        )}

        {/* ── Plan Cards ── */}
        <Box style={styles.plansContainer}>
          <Animated.View
            entering={FadeInDown.duration(duration.slow).delay(200)}
          >
            <ProPlanCard
              isPro={isPro}
              isAnnual={isAnnual}
              loading={loading}
              color={color}
              isDark={isDark}
              proPlan={proPlan}
              handleUpgrade={handleUpgrade}
              handleManage={handleManage}
            />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.duration(duration.slow).delay(300)}
            exiting={FadeOut.duration(duration.normal)}
          >
            <FreePlanCard
              isPro={isPro}
              color={color}
              isDark={isDark}
              freePlan={freePlan}
            />
          </Animated.View>
        </Box>

        {/* ── Footer ── */}
        <Box style={styles.footer}>
          <Text
            variant="caption"
            style={[styles.footerText, { color: color.muted }]}
          >
            Subscriptions are managed through your device's App Store. You can
            cancel anytime from your settings.
          </Text>
          {!isPro && (
            <Pressable
              onPress={handleRestore}
              style={{ marginTop: spacing.md }}
              accessibilityLabel="Check your subscription status"
              accessibilityRole="link"
              accessibilityHint="Checks whether your account has an active Pro subscription"
            >
              <Text
                variant="bodySmall"
                style={{
                  color: color.foreground,
                  textDecorationLine: "underline",
                }}
              >
                Check subscription status
              </Text>
            </Pressable>
          )}
        </Box>
      </ScrollArea>

      <CheckoutSheet
        visible={showCheckout}
        session={checkoutSession}
        plan={checkoutPlan}
        email={email}
        onDismiss={handleCheckoutDismiss}
        onComplete={handleCheckoutComplete}
      />
    </Box>
  );
}
