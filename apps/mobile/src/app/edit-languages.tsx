import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Button, LanguageSelectionGrid } from "@/components";
import { Box, ScrollArea, Text } from "@/components/ui";
import { usePermissions } from "@/hooks";
import { useStyles, useTokens } from "@/hooks/ui";
import type { Tokens } from "@/hooks/ui";
import { useFadeIn } from "@/hooks/useAnimation";
import { useLanguageSelection } from "@/hooks/useLanguageSelection";
import { settingsActions } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

export default function EditLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { color, spacing, typography, borderRadius } = useTokens();
  const { selected, toggleLanguage, isComplete, remaining, isMaxed } =
    useLanguageSelection();
  const { maxSelectedLanguages } = usePermissions();

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
      gap: t.spacing.sm,
    },
  }));

  const handleSave = (): void => {
    if (!isComplete) return;

    settingsActions.setSelectedLanguages(selected);

    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const countColor = remaining === 0 ? color.success : color.muted;

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
          headerTintColor: color.foreground,
        }}
      />

      <Animated.View style={[styles.header, headerStyle]}>
        <Text variant="bodySmall" style={styles.subtitle}>
          Select exactly {maxSelectedLanguages} languages you work with. Tap to
          select, tap again to remove.
        </Text>
      </Animated.View>

      <ScrollArea
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <LanguageSelectionGrid
          selected={selected}
          onToggle={toggleLanguage}
          isMaxed={isMaxed}
        />
      </ScrollArea>

      <Box style={styles.bottomSection}>
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
          <Text variant="caption" style={{ color: countColor }}>
            {isMaxed
              ? `${selected.length}/${maxSelectedLanguages} selected`
              : `${selected.length}/${maxSelectedLanguages} selected — ${remaining} more needed`}
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
          label={isComplete ? "Save Changes" : `Select ${remaining} more`}
          disabled={!isComplete}
          onPress={handleSave}
        />
      </Box>
    </Box>
  );
}
