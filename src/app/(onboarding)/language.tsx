import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, Text, SafeArea, ScrollArea, ScreenContainer } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { settingsActions, settings$, auth$ } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

export default function OnboardingLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { setSelectedLanguages, setTargetLanguage, setOnboardingCompleted } =
    settingsActions;
  const [selected, setSelected] = useState<string[]>(() =>
    settings$.selectedLanguages.get(),
  );

  const { color } = useTheme();

  const toggleLanguage = (code: string): void => {
    if (selected.includes(code)) {
      triggerHaptic();
      setSelected((prev) => prev.filter((c) => c !== code));
    } else {
      if (selected.length >= 5) {
        triggerHaptic(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      setSelected((prev) => [...prev, code]);
    }
  };

  const handleContinue = (): void => {
    if (selected.length !== 5) return;

    setSelectedLanguages(selected);
    setTargetLanguage(selected[0]);
    setOnboardingCompleted(true);

    const session = auth$.session.get();
    if (session) {
      router.replace("/(tabs)");
    } else {
      router.replace("/(auth)/login");
    }
  };

  return (
    <ScreenContainer style={{ flex: 1, backgroundColor: color.background }}>
      <Box style={styles.header}>
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text
            variant="display"
            style={[styles.title, { color: color.foreground }]}
          >
            Choose your 5 languages
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <Text
            variant="body"
            style={[styles.subtitle, { color: color.muted }]}
          >
            Select exactly 5 languages to use in your studio. You can change
            these later in settings.
          </Text>
        </Animated.View>
      </Box>

      <ScrollArea style={styles.scrollView}>
        <LanguageSelectionGrid selected={selected} onToggle={toggleLanguage} />
      </ScrollArea>

      <Box
        style={[
          styles.bottomSection,
          { borderTopColor: color.border, backgroundColor: color.background },
        ]}
      >
        <Button
          variant="primary"
          size="large"
          label={
            selected.length === 5
              ? "Start Translating"
              : `Select ${5 - selected.length} more`
          }
          disabled={selected.length !== 5}
          onPress={handleContinue}
          style={
            selected.length === 5
              ? { backgroundColor: color.secondary }
              : undefined
          }
        />
      </Box>
    </ScreenContainer>
  );
}

const styles = {
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing["2xl"],
    paddingBottom: spacing.md,
  } as const,
  title: {
    marginBottom: spacing.sm,
  } as const,
  subtitle: {} as const,
  scrollView: { flex: 1, paddingHorizontal: spacing.lg } as const,
  bottomSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing["3xl"],
    paddingTop: spacing.md,
    borderTopWidth: 1,
  } as const,
};
