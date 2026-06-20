import React, { useMemo, useState, useCallback } from "react";
import { SectionList } from "react-native";

import { Button } from "./Button";
import { Sheet } from "./ui/Sheet";

import { LanguageRow, LanguageSearchBar } from "@/components/language";
import { Box, Text } from "@/components/ui";
import { LANGUAGES, type Language } from "@/constants/languages";
import { usePermissions } from "@/hooks";
import { useTokens } from "@/hooks/ui";
import { AppAlert } from "@/utils";

export interface LanguagePickerSheetProps {
  isVisible: boolean;
  selectedLanguages: string[];
  onSelectionChange: (selectedLanguages: string[]) => void;
  onClose: () => void;
  singleSelect?: boolean;
}

export const LanguagePickerSheet = ({
  isVisible,
  selectedLanguages,
  onSelectionChange,
  onClose,
  singleSelect = false,
}: LanguagePickerSheetProps): React.ReactElement => {
  const { color, spacing } = useTokens();
  const permissions = usePermissions();
  const maxSelectedLanguages = permissions.maxSelectedLanguages;
  const [searchQuery, setSearchQuery] = useState("");

  const availableLanguages = LANGUAGES;

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q === "") return availableLanguages;
    return availableLanguages.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q),
    );
  }, [searchQuery, availableLanguages]);

  const toggleSelection = useCallback((code: string): void => {
    if (singleSelect) {
      onSelectionChange([code]);
      return;
    }

    const isCurrentlySelected = selectedLanguages.includes(code);
    if (
      !isCurrentlySelected &&
      selectedLanguages.length >= maxSelectedLanguages
    ) {
      AppAlert.info(
        "Language Limit Reached",
        `You can only select up to ${maxSelectedLanguages} languages on your current plan. Upgrade to Pro for more.`,
      );
      return;
    }

    const next = isCurrentlySelected
      ? selectedLanguages.filter((c) => c !== code)
      : [...selectedLanguages, code];
    onSelectionChange(next);
  }, [singleSelect, selectedLanguages, maxSelectedLanguages, onSelectionChange]);

  const sections = useMemo(() => {
    const list: {
      title: string;
      data: Language[];
    }[] = [];
    list.push({
      title: searchQuery ? "RESULTS" : "ALL LANGUAGES",
      data: filteredLanguages,
    });
    return list;
  }, [filteredLanguages, searchQuery]);

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <Box
        style={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          backgroundColor: color.surface,
        }}
      >
        <Text variant="caption" style={{ color: color.muted }}>
          {section.title}
        </Text>
      </Box>
    ),
    [color, spacing],
  );

  const renderItem = useCallback(
    ({
      item,
    }: {
      item: Language;
    }) => (
      <LanguageRow
        code={item.code}
        isSelected={selectedLanguages.includes(item.code)}
        onPress={() => toggleSelection(item.code)}
      />
    ),
    [selectedLanguages, toggleSelection],
  );

  return (
    <Sheet visible={isVisible} onClose={onClose} maxHeight="80%">
      <Box style={{ zIndex: 1, backgroundColor: color.background }}>
        <Box
          style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}
        >
          <LanguageSearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </Box>
      </Box>

      <SectionList
        sections={sections}
        keyExtractor={(item: Language) => item.code}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      {!singleSelect && (
        <Box
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            borderTopWidth: 0.5,
            backgroundColor: color.background,
            borderTopColor: color.border,
            alignItems: "center",
          }}
        >
          <Button
            label="Confirm"
            onPress={onClose}
            variant="primary"
            style={{ minWidth: 200 }}
          />
        </Box>
      )}
    </Sheet>
  );
};
