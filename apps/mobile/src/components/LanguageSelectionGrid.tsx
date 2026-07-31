import React, { memo, useMemo } from "react";
import { View } from "react-native";

import { LanguageGridCard } from "@/components/language";
import { LANGUAGES, getLanguageName } from "@/constants/languages";
import { spacing } from "@/constants/spacing";

export interface LanguageSelectionGridProps {
  selected: string[];
  onToggle: (code: string) => void;
  isMaxed?: boolean;
}

const LanguageGridItem = memo(function LanguageGridItem({
  code,
  label,
  isSelected,
  isMaxed,
  onToggle,
}: {
  code: string;
  label: string;
  isSelected: boolean;
  isMaxed: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <View style={{ width: "50%", padding: spacing.xs }}>
      <LanguageGridCard
        code={code}
        label={label}
        isSelected={isSelected}
        disabled={!isSelected && isMaxed}
        onPress={() => onToggle(code)}
        width="100%"
        aspectRatio={2.2}
      />
    </View>
  );
});

export function LanguageSelectionGrid({
  selected,
  onToggle,
  isMaxed = false,
}: LanguageSelectionGridProps): React.ReactElement {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const items = useMemo(
    () =>
      LANGUAGES.map((lang) => {
        const code = lang.code;
        return (
          <LanguageGridItem
            key={code}
            code={code}
            label={getLanguageName(code)}
            isSelected={selectedSet.has(code)}
            isMaxed={isMaxed}
            onToggle={onToggle}
          />
        );
      }),
    [selectedSet, isMaxed, onToggle],
  );

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        paddingTop: spacing.md,
        paddingBottom: spacing["2xl"],
        marginHorizontal: -spacing.xs,
      }}
    >
      {items}
    </View>
  );
}
