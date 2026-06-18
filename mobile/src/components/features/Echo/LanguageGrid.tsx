import { useSelector } from "@legendapp/state/react";
import React, { useMemo } from "react";

import { LanguageGridCard } from "@/components/language";
import { Box } from "@/components/ui";
import { ECHO_CONSTANTS } from "@/constants/echo";
import { LANGUAGES } from "@/constants/languages";
import { usePermissions } from "@/hooks";
import { settings$ } from "@/store";
import { AppAlert } from "@/utils";

interface LanguageGridProps {
  selectedLang: string;
  onSelect: (code: string) => void;
}

export const LanguageGrid: React.FC<LanguageGridProps> = ({
  selectedLang,
  onSelect,
}) => {
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const permissions = usePermissions();
  const canUseAuto = permissions.autoLanguageDetect;

  const topLanguages = useMemo(() => {
    return selectedLanguages
      .slice(0, ECHO_CONSTANTS.LANGUAGE_GRID.MAX_TOP_LANGS)
      .map((code) => LANGUAGES.find((l) => l.code === code))
      .filter(Boolean);
  }, [selectedLanguages]);

  return (
    <Box
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: ECHO_CONSTANTS.LANGUAGE_GRID.GAP,
      }}
    >
      {topLanguages.map((lang) => (
        <LanguageGridCard
          key={lang!.code}
          code={lang!.code}
          label={lang!.englishName}
          isSelected={selectedLang === lang!.code}
          onPress={() => onSelect(lang!.code)}
          width="30%"
          aspectRatio={1}
        />
      ))}

      <LanguageGridCard
        code="auto"
        label="Auto-Detect"
        isSelected={selectedLang === "auto"}
        dashed
        disabled={!canUseAuto}
        onPress={() => {
          if (canUseAuto) {
            onSelect("auto");
          } else {
            AppAlert.info(
              "Ekwe Pro",
              "Auto-detecting languages is a premium feature. Upgrade to Pro to use this.",
            );
          }
        }}
        width="30%"
        aspectRatio={1}
      />
    </Box>
  );
};
