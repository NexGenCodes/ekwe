import { useValue } from "@legendapp/state/react";
import Globe from "lucide-react-native/icons/globe";
import React, { useMemo } from "react";

import { LanguageFlag } from "@/components/language";
import { Box, Pressable, Text } from "@/components/ui";
import { ECHO_CONSTANTS, STEP_METADATA } from "@/constants/echo";
import { LANGUAGES, type Language } from "@/constants/languages";
import { usePermissions } from "@/hooks/usePermissions";
import { useTokens } from "@/hooks/ui";
import { settings$ } from "@/store";
import { AppAlert } from "@/utils/alert";
import { triggerHaptic } from "@/utils/haptics";

export interface EchoLanguagePickerProps {
  selectedLang: string;
  onSelect: (code: string) => void;
}

interface PickerOption {
  code: string;
  label: string;
  disabled: boolean;
  dashed: boolean;
  icon: React.ReactNode;
  onPress?: () => void;
}

export const EchoLanguagePicker: React.FC<EchoLanguagePickerProps> = React.memo(
  ({ selectedLang, onSelect }) => {
    const { color, spacing, borderRadius, opacity } = useTokens();
    const selectedLanguages = useValue(() => settings$.selectedLanguages.get());
    const permissions = usePermissions();
    const canUseAuto = permissions.autoLanguageDetect;

    const topOptions = useMemo(
      () =>
        selectedLanguages
          .slice(0, ECHO_CONSTANTS.LANGUAGE_GRID.MAX_TOP_LANGS)
          .map((code) => LANGUAGES.find((l) => l.code === code))
          .filter((lang): lang is Language => Boolean(lang)),
      [selectedLanguages],
    );

    const setAuto = (): void => {
      if (canUseAuto) {
        onSelect("auto");
      } else {
        AppAlert.info(
          "Ekwe Pro",
          "Auto-detecting languages is a premium feature. Upgrade to Pro to use this.",
        );
      }
    };

    const renderCard = (option: PickerOption): React.ReactElement => {
      const isSelected = selectedLang === option.code;
      return (
        <Pressable
          key={option.code}
          feedback="scale"
          disabled={option.disabled}
          onPress={() => {
            triggerHaptic();
            if (option.onPress) {
              option.onPress();
            } else {
              onSelect(option.code);
            }
          }}
          accessibilityLabel={`${option.label}${
            isSelected ? ", selected" : ""
          }`}
          accessibilityRole="button"
          accessibilityState={{
            selected: isSelected,
            disabled: option.disabled,
          }}
          style={{
            flexBasis: "30%",
            maxWidth: "30%",
            aspectRatio: ECHO_CONSTANTS.LANGUAGE_GRID.CARD_ASPECT_RATIO,
            borderRadius: borderRadius["2xl"],
            borderWidth: 1,
            borderStyle: option.dashed ? "dashed" : "solid",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: spacing.md,
            backgroundColor: isSelected ? color.brand : color.background,
            borderColor: isSelected ? color.brand : color.border,
            opacity: option.disabled ? opacity.disabled : 1,
          }}
        >
          <Box
            style={{
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {option.icon}
          </Box>
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{
              textAlign: "center",
              color: isSelected ? color.onBrand : color.foreground,
            }}
          >
            {option.label}
          </Text>
        </Pressable>
      );
    };

    const autoOption: PickerOption = {
      code: "auto",
      label: "Auto-Detect",
      disabled: !canUseAuto,
      dashed: true,
      icon: (
        <Globe
          size={24}
          color={selectedLang === "auto" ? color.onBrand : color.brand}
        />
      ),
    };

    return (
      <Box>
        <Box
          style={{
            marginBottom: spacing.lg,
          }}
        >
          <Text variant="heading3">{STEP_METADATA.PickLanguage.title}</Text>
        </Box>
        <Box
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: ECHO_CONSTANTS.LANGUAGE_GRID.GAP,
          }}
        >
          {topOptions.map((lang) =>
            renderCard({
              code: lang!.code,
              label: lang!.englishName,
              disabled: false,
              dashed: false,
              icon: <LanguageFlag code={lang!.code} size="md" />,
            }),
          )}
          {renderCard({ ...autoOption, onPress: setAuto })}
        </Box>
      </Box>
    );
  },
);
