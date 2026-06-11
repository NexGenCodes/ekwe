import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, ScreenContainer, Text, Pressable } from "@/components/ui";
import { duration } from "@/constants/motion";
import { useTokens } from "@/hooks/ui";
import { useLanguageSelection } from "@/hooks/useLanguageSelection";
import { settingsActions, auth$ } from "@/store";
import { track, AnalyticsEvents } from "@/utils/analytics";
import { triggerHaptic } from "@/utils/haptics";

const HEADING = "Pick your languages";
const SUBTITLE =
  "Choose up to 5 languages you work with. Tap to select, tap again to remove. You can always change these later.";

export default function OnboardingLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { color, spacing, isDark } = useTokens();
  const { selected, toggleLanguage, isComplete, remaining } =
    useLanguageSelection();

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: duration.slower,
      easing: Easing.out(Easing.cubic),
    });
    translateY.value = withTiming(0, {
      duration: duration.slower,
      easing: Easing.out(Easing.cubic),
    });
  }, [opacity, translateY]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const handleContinue = useCallback(async (): Promise<void> => {
    if (!isComplete) return;

    await triggerHaptic();

    settingsActions.setSelectedLanguages(selected);
    settingsActions.setTargetLanguage(selected[0]);
    settingsActions.setOnboardingCompleted(true);
    track(AnalyticsEvents.ONBOARDING_COMPLETED, {
      languageCount: selected.length,
      targetLanguage: selected[0],
    });

    const session = auth$.session.get();
    router.replace(session ? "/(tabs)" : "/(auth)/login");
  }, [isComplete, selected, router]);

  const handleSkip = useCallback(async (): Promise<void> => {
    await triggerHaptic();
    settingsActions.setOnboardingCompleted(true);
    track(AnalyticsEvents.ONBOARDING_COMPLETED, {
      skipped: true,
    });
    const session = auth$.session.get();
    router.replace(session ? "/(tabs)" : "/(auth)/login");
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: color.background }}>
      <ScreenContainer
        scroll
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          // Extra padding bottom so the last item scrolls past the absolute footer
          paddingBottom: 140,
        }}
        style={{ backgroundColor: color.background }}
      >
        <Animated.View style={containerStyle}>
          <Box
            style={{
              paddingTop: spacing["2xl"],
              paddingBottom: spacing.md,
            }}
          >
            <Text
              variant="display"
              style={{
                marginBottom: spacing.sm,
                color: color.foreground,
                letterSpacing: -0.5,
              }}
            >
              {HEADING}
            </Text>
            <Text
              variant="body"
              style={{
                color: color.muted,
                lineHeight: 24,
              }}
            >
              {SUBTITLE}
            </Text>
          </Box>

          <LanguageSelectionGrid
            selected={selected}
            onToggle={toggleLanguage}
          />
        </Animated.View>
      </ScreenContainer>

      {/* Floating Blurred Footer */}
      <View style={styles.footerContainer}>
        <BlurView
          intensity={80}
          tint={isDark ? "dark" : "light"}
          style={[
            styles.blurView,
            {
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.md,
              borderTopWidth: 1,
              borderTopColor: color.border + "80", // 50% opacity border
              backgroundColor: color.background + "99", // 60% opacity background
              alignItems: "center", // Center the button
            },
          ]}
        >
          <Button
            variant="primary"
            size="large"
            label={
              isComplete
                ? "Create Account to Continue"
                : `Select ${remaining} more`
            }
            disabled={!isComplete}
            onPress={handleContinue}
            style={{ minWidth: 250 }}
          />
          <Pressable
            onPress={handleSkip}
            style={{
              marginTop: spacing.sm,
              alignItems: "center",
              paddingVertical: spacing.xs,
            }}
            accessibilityLabel="Skip language selection"
            hitSlop={8}
          >
            <Text
              variant="bodySmall"
              style={{ color: color.muted, textDecorationLine: "underline" }}
            >
              Skip for now
            </Text>
          </Pressable>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footerContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  blurView: {
    width: "100%",
  },
});
