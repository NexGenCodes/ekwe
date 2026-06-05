import { useRouter } from "expo-router";
import { Type, Copy, Eye } from "lucide-react-native";
import React from "react";

import { ProfileRow } from "../ProfileRow";
import { AnimatedSection } from "./AnimatedSection";

import { Switch } from "@/components/ui";
import { useTheme } from "@/hooks";
import { AppAlert } from "@/utils/alert";
import { triggerHaptic } from "@/utils/haptics";

interface SmartFeaturesSectionProps {
  isPro: boolean;
  showTransliteration: boolean;
  onTransliterationChange: (value: boolean) => void;
  autoCopy: boolean;
  onAutoCopyChange: (value: boolean) => void;
  hasPermission: boolean | null;
}

export function SmartFeaturesSection({
  isPro,
  showTransliteration,
  onTransliterationChange,
  autoCopy,
  onAutoCopyChange,
  hasPermission,
}: SmartFeaturesSectionProps): React.JSX.Element {
  const { color } = useTheme();
  const router = useRouter();

  const requirePro = (action: () => void): void => {
    if (!isPro) {
      AppAlert.info(
        "Ekwe Pro Required",
        "This is a premium feature. Please upgrade to use this.",
      );
      return;
    }
    action();
  };

  return (
    <AnimatedSection delay={200} title="Smart Features">
      <ProfileRow
        icon={Type}
        sfIcon="textformat"
        iconColor={color.primary}
        title="Show Transliteration"
        subtitle="Pronunciation guide for translations"
        onPress={async () => {
          await triggerHaptic();
          requirePro(() => onTransliterationChange(!showTransliteration));
        }}
        hasDivider
        trailing={
          <Switch
            value={showTransliteration && isPro}
            onValueChange={(value) =>
              requirePro(() => onTransliterationChange(value))
            }
            disabled={!isPro}
          />
        }
      />
      <ProfileRow
        icon={Copy}
        sfIcon="doc.on.doc.fill"
        iconColor={color.primary}
        title="Auto-copy to Clipboard"
        subtitle="Copy translation automatically"
        onPress={async () => {
          await triggerHaptic();
          onAutoCopyChange(!autoCopy);
        }}
        hasDivider
        trailing={<Switch value={autoCopy} onValueChange={onAutoCopyChange} />}
      />
      <ProfileRow
        icon={Eye}
        sfIcon="eye.fill"
        iconColor={color.primary}
        title="Floating Translation Bubble"
        subtitle="Translate inline in external apps"
        onPress={async () => {
          await triggerHaptic();
          requirePro(() => router.push("/accessibility-disclosure"));
        }}
        trailing={
          <Switch
            value={!!hasPermission}
            onValueChange={async (value) => {
              if (value) {
                requirePro(() => router.push("/accessibility-disclosure"));
              }
            }}
            disabled={!isPro}
          />
        }
      />
    </AnimatedSection>
  );
}
