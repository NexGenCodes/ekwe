import { useRouter } from "expo-router";
import React, { useCallback, useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, ScreenContainer, Text } from "@/components/ui";
import { duration } from "@/constants/motion";
import { useTokens } from "@/hooks/ui";
import { useLanguageSelection } from "@/hooks/useLanguageSelection";
import { settingsActions, auth$ } from "@/store";

const HEADING = "Pick your 5 languages";
const SUBTITLE =
  "Choose 5 languages you work with. Tap to select, tap again to swap. You can always change these later.";

export default function OnboardingLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { color, spacing } = useTokens();
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

  const handleContinue = useCallback((): void => {
    if (!isComplete) return;

    settingsActions.setSelectedLanguages(selected);
    settingsActions.setTargetLanguage(selected[0]);
    settingsActions.setOnboardingCompleted(true);

    const session = auth$.session.get();
    router.replace(session ? "/(tabs)" : "/(auth)/login");
  }, [isComplete, selected, router]);

  const footer = (
    <Box
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing["3xl"],
        paddingTop: spacing.md,
        borderTopWidth: 1,
        borderTopColor: color.border,
        backgroundColor: color.background,
      }}
    >
      <Button
        variant="primary"
        size="large"
        label={isComplete ? "Start Translating" : `Select ${remaining} more`}
        disabled={!isComplete}
        onPress={handleContinue}
        style={{ width: "100%" }}
      />
    </Box>
  );

  return (
    <ScreenContainer
      scroll
      footer={footer}
      contentContainerStyle={{
        paddingHorizontal: spacing.md,
        paddingBottom: spacing["4xl"],
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

        <LanguageSelectionGrid selected={selected} onToggle={toggleLanguage} />
      </Animated.View>
    </ScreenContainer>
  );
}
