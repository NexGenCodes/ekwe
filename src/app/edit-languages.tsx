import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import React from "react";
import Animated from "react-native-reanimated";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, ScrollArea, Text } from "@/components/ui";
import { useStyles, useTokens } from "@/hooks/ui";
import type { Tokens } from "@/hooks/ui";
import { useFadeIn } from "@/hooks/useAnimation";
import { useLanguageSelection } from "@/hooks/useLanguageSelection";
import { settings$, settingsActions } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

export default function EditLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { color, typography } = useTokens();
  const { selected, toggleLanguage, isComplete, remaining } =
    useLanguageSelection();

  const headerStyle = useFadeIn({ duration: 400 });

  const styles = useStyles((t: Tokens) => ({
    flex1: { flex: 1, backgroundColor: t.color.background },
    header: {
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.md,
      paddingBottom: t.spacing.sm,
    },
    subtitle: {
      color: t.color.muted,
    },
    scrollView: {
      flex: 1,
      paddingHorizontal: t.spacing.lg,
    },
    bottomSection: {
      paddingHorizontal: t.spacing.lg,
      paddingBottom: t.spacing["3xl"],
      paddingTop: t.spacing.md,
      borderTopWidth: 1,
      borderTopColor: t.color.border,
    },
  }));

  const handleSave = (): void => {
    if (!isComplete) return;

    settingsActions.setSelectedLanguages(selected);

    const pinned = settings$.pinnedLanguages.get();
    const newPinned = pinned.filter((p) => selected.includes(p));
    settingsActions.setPinnedLanguages(newPinned);

    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <Box style={styles.flex1}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Edit Languages",
          headerBackTitle: "Profile",
          headerStyle: { backgroundColor: color.background },
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: typography.heading3.fontFamily,
            color: color.foreground,
          },
          headerTintColor: color.primary,
        }}
      />

      <Animated.View style={[styles.header, headerStyle]}>
        <Text variant="bodySmall" style={styles.subtitle}>
          Select exactly 5 languages to use in your translation studio. You can
          change these anytime.
        </Text>
      </Animated.View>

      <ScrollArea
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <LanguageSelectionGrid selected={selected} onToggle={toggleLanguage} />
      </ScrollArea>

      <Box style={styles.bottomSection}>
        <Button
          variant="primary"
          size="large"
          label={isComplete ? "Save Changes" : `Select ${remaining} more`}
          disabled={!isComplete}
          onPress={handleSave}
        />
      </Box>
    </Box>
  );
}
