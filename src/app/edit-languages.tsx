import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Button, LanguageSelectionGrid } from '@/components';
import { Box, ScrollArea, Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useTheme } from '@/hooks';
import { settings$, settingsActions } from '@/store';
import { triggerHaptic } from '@/utils/haptics';

export default function EditLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();

  const initialSelected = settings$.selectedLanguages.get();
  const [selected, setSelected] = useState<string[]>(initialSelected);

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

  const handleSave = (): void => {
    if (selected.length !== 5) return;
    settingsActions.setSelectedLanguages(selected);

    // Ensure pinned languages don't contain removed languages
    const pinned = settings$.pinnedLanguages.get();
    const newPinned = pinned.filter((p) => selected.includes(p));
    settingsActions.setPinnedLanguages(newPinned);

    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <Box style={[styles.flex1, { backgroundColor: color.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Edit Languages',
          headerBackTitle: 'Profile',
          headerStyle: { backgroundColor: color.background },
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: typography.heading3.fontFamily,
            color: color.foreground,
          },
          headerTintColor: color.primary,
        }}
      />

      <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
        <Text variant="bodySmall" style={{ color: color.muted }}>
          Select exactly 5 languages to use in your translation studio. You can
          change these anytime.
        </Text>
      </Animated.View>

      <ScrollArea
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing['2xl'] }}
      >
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
              ? 'Save Changes'
              : `Select ${5 - selected.length} more`
          }
          disabled={selected.length !== 5}
          onPress={handleSave}
        />
      </Box>
    </Box>
  );
}

const styles = {
  flex1: { flex: 1 } as const,
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  } as const,
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  } as const,
  bottomSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
    paddingTop: spacing.md,
    borderTopWidth: 1,
  } as const,
};
