import { useValue } from "@legendapp/state/react";
import { triggerHaptic } from "@/utils/haptics";
import { Stack } from "expo-router";
import Crown from "lucide-react-native/icons/crown";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Sparkles from "lucide-react-native/icons/sparkles";
import React, { useEffect, useMemo, useRef } from "react";
import Animated, {
  FadeInDown,
  ZoomIn,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import { GradientMesh } from "@/components/GradientMesh";
import { IconContainer } from "@/components/IconContainer";
import { BillingToggle } from "@/components/billing/BillingToggle";
import { CheckoutSheet } from "@/components/billing/CheckoutSheet";
import { FreePlanCard } from "@/components/billing/FreePlanCard";
import { ProPlanCard } from "@/components/billing/ProPlanCard";
import { Box, Text, Pressable, ScrollArea, Spinner } from "@/components/ui";
import { shadows } from "@/constants";
import { useTheme, useTokens } from "@/hooks";
import { useBilling } from "@/hooks/billing/useBilling";
import { auth$ } from "@/store";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { withAlpha } from "@/utils/color";

export default function BillingScreen(): React.ReactElement {
  const { color, isDark } = useTheme();
  const tokens = useTokens();
  const { spacing, borderRadius, duration } = tokens;

  const sessionLoaded = useValue(() => auth$.sessionLoaded.get());

  const {
    isPro,
    isAnnual,
    setIsAnnual,
    handleUpgrade,
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

  const hasTrackedViewRef = useRef(false);
  useEffect(() => {
    if (hasTrackedViewRef.current) return;
    hasTrackedViewRef.current = true;
    track(AnalyticsEvents.BILLING_PAGE_VIEWED, { isPro });
  }, [isPro]);

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
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing["4xl"],
      } as const,

      heroBanner: {
        alignItems: "center",
        paddingTop: spacing.lg,
        paddingHorizontal: spacing.md,
      } as const,
      heroTitle: {
        marginTop: spacing.md,
        marginBottom: spacing.sm,
        textAlign: "center",
        maxWidth: 320,
      } as const,
      heroSubtitle: {
        textAlign: "center",
        maxWidth: 320,
      } as const,

      toggleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        position: "relative",
        marginTop: spacing.xl,
        marginBottom: spacing["2xl"],
      } as const,
      toggleFlex: { flex: 1 } as const,
      savingsBadgeWrap: {
        position: "absolute",
        top: -10,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 1,
      } as const,
      savingsChip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.full,
      } as const,

      plansContainer: { gap: spacing.xl } as const,

      footer: {
        paddingTop: spacing["2xl"],
        alignItems: "center",
        paddingHorizontal: spacing.xl,
        gap: spacing.sm,
      } as const,
      trustRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
      } as const,
      footerText: {
        textAlign: "center",
        maxWidth: 320,
      } as const,
    }),
    [spacing, borderRadius],
  );

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
        {}
        <Box accessible accessibilityRole="header" style={styles.heroBanner}>
          <Animated.View entering={ZoomIn.duration(duration.slow)}>
            <IconContainer
              size={72}
              variant="custom"
              backgroundColor={withAlpha(color.brand, 0.1)}
              style={{ boxShadow: shadows.softLg }}
            >
              {isPro ? (
                <Crown
                  size={32}
                  color={color.brand}
                  strokeWidth={2.5}
                  fill={color.brand}
                />
              ) : (
                <Sparkles size={32} color={color.brand} strokeWidth={2.5} />
              )}
            </IconContainer>
          </Animated.View>
          <Animated.View
            key={isPro ? "pro" : "free"}
            entering={FadeIn.duration(duration.slow)}
          >
            <Text
              variant="heading1"
              style={[styles.heroTitle, { color: color.foreground }]}
            >
              {isPro ? "You're on Ekwe Pro" : "Unlock Ekwe Pro"}
            </Text>
            <Text
              variant="body"
              style={[styles.heroSubtitle, { color: color.muted }]}
            >
              {isPro
                ? "Enjoy every premium feature."
                : "Premium voices, live dictation, and higher limits."}
            </Text>
          </Animated.View>
        </Box>

        {}
        {!isPro && (
          <Animated.View
            entering={FadeIn.duration(duration.normal)}
            exiting={FadeOut.duration(duration.normal)}
          >
            <Box style={styles.toggleRow}>
              {isAnnual && (
                <Animated.View
                  entering={FadeIn.duration(duration.fast)}
                  exiting={FadeOut.duration(duration.fast)}
                  style={styles.savingsBadgeWrap}
                  pointerEvents="none"
                >
                  <Box
                    style={[
                      styles.savingsChip,
                      { backgroundColor: color.success },
                    ]}
                  >
                    <Text
                      variant="caption"
                      style={{ color: color.onBrand, fontWeight: "800" }}
                    >
                      Save {annualSavingPercent}%
                    </Text>
                  </Box>
                </Animated.View>
              )}
              <Box style={styles.toggleFlex}>
                <BillingToggle
                  isAnnual={isAnnual}
                  onToggle={async (annual) => {
                    await triggerHaptic("selection");
                    track(AnalyticsEvents.BILLING_TOGGLED, {
                      cycle: annual ? "annual" : "monthly",
                    });
                    setIsAnnual(annual);
                  }}
                  color={color}
                />
              </Box>
            </Box>
          </Animated.View>
        )}

        {}
        <Box style={styles.plansContainer}>
          <Animated.View
            entering={FadeInDown.duration(duration.slow).delay(150)}
          >
            <ProPlanCard
              isPro={isPro}
              isAnnual={isAnnual}
              loading={loading}
              color={color}
              isDark={isDark}
              proPlan={proPlan}
              handleUpgrade={handleUpgrade}
              handleRestore={handleRestore}
            />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.duration(duration.slow).delay(250)}
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

        {}
        <Box style={styles.footer}>
          <Box style={styles.trustRow}>
            <ShieldCheck size={14} color={color.muted} strokeWidth={2} />
            <Text
              variant="caption"
              style={[styles.footerText, { color: color.muted }]}
            >
              Secure payments powered by Flutterwave
            </Text>
          </Box>
          <Text
            variant="bodySmall"
            style={[styles.footerText, { color: color.muted }]}
          >
            One-time purchase. No auto-renewal.
          </Text>
          {!isPro && (
            <Pressable
              onPress={() => {
                triggerHaptic();
                void handleRestore();
              }}
              style={{ marginTop: spacing.sm }}
              accessibilityLabel="Check your Pro status"
              accessibilityRole="link"
              accessibilityHint="Checks whether your account has active Pro access"
            >
              <Text
                variant="bodySmall"
                style={{
                  color: color.foreground,
                  textDecorationLine: "underline",
                }}
              >
                Check Pro status
              </Text>
            </Pressable>
          )}
        </Box>
      </ScrollArea>

      <CheckoutSheet
        visible={showCheckout}
        session={checkoutSession}
        plan={checkoutPlan}
        onDismiss={handleCheckoutDismiss}
        onComplete={handleCheckoutComplete}
      />
    </Box>
  );
}
