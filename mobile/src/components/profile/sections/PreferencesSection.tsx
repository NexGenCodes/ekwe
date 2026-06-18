import { ChevronRight, Globe, Smartphone, Palette } from "lucide-react-native";
import React from "react";

import { ProfileRow } from "../ProfileRow";
import { AnimatedSection } from "./AnimatedSection";

import { Box, Switch, Text } from "@/components/ui";
import { SUPPORTED_CURRENCIES, spacing } from "@/constants";
import { useTheme } from "@/hooks";
import { triggerHaptic } from "@/utils/haptics";

interface PreferencesSectionProps {
  selectedLanguages: number;
  hapticsEnabled: boolean;
  onHapticsChange: (value: boolean) => void;
  currency: string;
  onCurrencyPress: () => void;
  colorScheme: string;
  onThemePress: () => void;
  onLanguageGridPress: () => void;
}

export function PreferencesSection({
  selectedLanguages,
  hapticsEnabled,
  onHapticsChange,
  currency,
  onCurrencyPress,
  colorScheme,
  onThemePress,
  onLanguageGridPress,
}: PreferencesSectionProps): React.JSX.Element {
  const { color } = useTheme();
  const schemeLabel =
    colorScheme === "light"
      ? "Light"
      : colorScheme === "dark"
        ? "Dark"
        : "System";

  return (
    <AnimatedSection delay={150} title="App Preferences">
      <ProfileRow
        icon={Globe}
        sfIcon="globe"
        iconColor={color.primary}
        title="Edit Language Grid"
        subtitle={`${selectedLanguages}/5 active languages`}
        hasDivider
        onPress={onLanguageGridPress}
      />
      <ProfileRow
        icon={Smartphone}
        sfIcon="hand.tap.fill"
        iconColor={color.primary}
        title="Haptic Feedback"
        subtitle="Vibrate on user actions"
        hasDivider
        onPress={async () => {
          await triggerHaptic();
          onHapticsChange(!hapticsEnabled);
        }}
        trailing={
          <Switch value={hapticsEnabled} onValueChange={onHapticsChange} />
        }
      />
      <ProfileRow
        icon={Globe}
        sfIcon="globe"
        iconColor={color.primary}
        title="Display Currency"
        subtitle="Choose your preferred currency"
        hasDivider
        onPress={async () => {
          await triggerHaptic();
          onCurrencyPress();
        }}
        trailing={
          <Box style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              variant="body"
              style={{ color: color.muted, marginRight: spacing.sm }}
            >
              {SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.code ||
                currency}
            </Text>
            <ChevronRight size={16} color={color.muted} />
          </Box>
        }
      />
      <ProfileRow
        icon={Palette}
        sfIcon="paintpalette.fill"
        iconColor={color.primary}
        title="Appearance"
        subtitle="Light, Dark, or System"
        onPress={async () => {
          await triggerHaptic();
          onThemePress();
        }}
        trailing={
          <Box style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              variant="body"
              style={{ color: color.muted, marginRight: spacing.sm }}
            >
              {schemeLabel}
            </Text>
            <ChevronRight size={16} color={color.muted} />
          </Box>
        }
      />
    </AnimatedSection>
  );
}
