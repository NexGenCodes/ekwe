import { triggerHaptic } from "@/utils/haptics";
import { Stack } from "expo-router";
import Crown from "lucide-react-native/icons/crown";
import Sparkles from "lucide-react-native/icons/sparkles";
import React, { useMemo } from "react";
import Animated, { FadeInDown, ZoomIn, FadeIn } from "react-native-reanimated";

import { GradientMesh } from "@/components/GradientMesh";
import { BillingToggle } from "@/components/billing/BillingToggle";
import { FreePlanCard } from "@/components/billing/FreePlanCard";
import { ProPlanCard } from "@/components/billing/ProPlanCard";
import { Box, Text, Pressable, ScrollArea } from "@/components/ui";
import { useTheme, useTokens } from "@/hooks";
import { useBilling } from "@/hooks/billing/useBilling";

export default function BillingScreen(): React.ReactElement {
  const { color, isDark } = useTheme();
  const tokens = useTokens();
  const { spacing, borderRadius, duration } = tokens;

  const {
    isPro,
    isAnnual,
    setIsAnnual,
    handleUpgrade,
    handleManage,
    handleRestore,
    freePlan,
    proPlan,
  } = useBilling();

  const styles = useMemo(
    () => ({
      flex1: { flex: 1 } as const,
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
            entering={ZoomIn.duration(duration.slow).delay(300)}
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
          <Animated.View entering={FadeIn.duration(duration.slow).delay(450)}>
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
                style={styles.savingsBadgeWrapper}
              >
                <Box
                  style={[
                    styles.savingsBadge,
                    { backgroundColor: color.success },
                  ]}
                >
                  <Text variant="caption" style={{ color: color.onBrand }}>
                    Save {proPlan.annualSavingPercent}%
                  </Text>
                </Box>
              </Animated.View>
            )}
          </Box>
        )}

        {/* ── Plan Cards ── */}
        <Box style={styles.plansContainer}>
          <Animated.View
            entering={FadeInDown.duration(duration.slow).delay(450)}
          >
            <ProPlanCard
              isPro={isPro}
              isAnnual={isAnnual}
              color={color}
              isDark={isDark}
              proPlan={proPlan}
              handleUpgrade={handleUpgrade}
              handleManage={handleManage}
            />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.duration(duration.slow).delay(600)}
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
    </Box>
  );
}
