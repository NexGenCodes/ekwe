import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, ScreenContainer, Text } from "@/components/ui";
import { usePermissions } from "@/hooks";
import { useTokens } from "@/hooks/ui";
import { useLanguageSelection } from "@/hooks/useLanguageSelection";
import { settingsActions, auth$ } from "@/store";
import { track, AnalyticsEvents } from "@/utils/analytics";

const HEADING = "Pick your languages";
const subtitleFor = (max: number): string =>
  `Choose exactly ${max} languages you work with. Tap to select, tap again to remove. You can always change these later.`;

export default function OnboardingLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { color, spacing, borderRadius } = useTokens();
  const { maxSelectedLanguages } = usePermissions();
  const { selected, toggleLanguage, isComplete, isMaxed } =
    useLanguageSelection();

  const handleContinue = useCallback(async (): Promise<void> => {
    if (!isComplete) return;

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

  const countColor = isComplete ? color.success : color.muted;

  return (
    <View style={{ flex: 1, backgroundColor: color.background }}>
      <ScreenContainer
        scroll
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing["7xl"] + spacing.lg,
        }}
        style={{ backgroundColor: color.background }}
      >
        <Box
          style={{
            paddingTop: spacing["3xl"],
            paddingBottom: spacing.lg,
          }}
        >
          <Text
            variant="display"
            style={{
              marginBottom: spacing.md,
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
              lineHeight: 26,
            }}
          >
            {subtitleFor(maxSelectedLanguages)}
          </Text>
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              marginTop: spacing.md,
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
            <Text variant="caption" style={{ color: countColor }}>
              {selected.length} of {maxSelectedLanguages} selected
            </Text>
          </Box>
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
          paddingBottom: insets.bottom + spacing.md,
          paddingHorizontal: spacing.xl,
        }}
      >
        <Button
          variant="primary"
          size="large"
          label="Continue"
          disabled={!isComplete}
          onPress={handleContinue}
          style={{ width: "100%" }}
        />
      </Box>
    </View>
  );
}
