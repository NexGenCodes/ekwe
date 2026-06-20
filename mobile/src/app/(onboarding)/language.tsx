import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { View } from "react-native";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, ScreenContainer, Text } from "@/components/ui";
import { useTokens } from "@/hooks/ui";
import { useLanguageSelection } from "@/hooks/useLanguageSelection";
import { settingsActions, auth$ } from "@/store";
import { track, AnalyticsEvents } from "@/utils/analytics";
import { triggerHaptic } from "@/utils/haptics";

const HEADING = "Pick your languages";
const SUBTITLE =
  "Choose exactly 5 languages you work with. Tap to select, tap again to remove. You can always change these later.";

export default function OnboardingLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { color, spacing, borderRadius } = useTokens();
  const { selected, toggleLanguage, isComplete, remaining, isMaxed } =
    useLanguageSelection();

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

  const countColor = remaining === 0 ? color.success : color.muted;

  return (
    <View style={{ flex: 1, backgroundColor: color.background }}>
      <ScreenContainer
        scroll
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingBottom: spacing["7xl"] + spacing["2xl"],
        }}
        style={{ backgroundColor: color.background }}
      >
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
          isMaxed={isMaxed}
        />
      </ScreenContainer>

      <Box
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: color.background,
          borderTopWidth: 1,
          borderTopColor: color.border,
          paddingTop: spacing.md,
          paddingBottom: spacing["3xl"],
          paddingHorizontal: spacing.md,
          gap: spacing.sm,
        }}
      >
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.xs,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: borderRadius.full,
              backgroundColor: countColor,
            }}
          />
          <Text
            variant="caption"
            style={{ color: countColor }}
          >
            {isMaxed
              ? `${selected.length}/${5} selected`
              : `${selected.length}/${5} selected — ${remaining} more needed`}
          </Text>
        </Box>

        {isMaxed && (
          <Text
            variant="caption"
            style={{
              color: color.muted,
              textAlign: "center",
            }}
          >
            Unselect a language to pick a different one
          </Text>
        )}

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
      </Box>
    </View>
  );
}
