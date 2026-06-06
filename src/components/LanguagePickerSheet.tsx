import { useSelector } from "@legendapp/state/react";
import React, { useMemo, useState, useCallback } from "react";
import { SectionList } from "react-native";

import { Button } from "./Button";
import { Sheet } from "./ui/Sheet";

import { LanguageRow, LanguageSearchBar } from "@/components/language";
import { Box, Text } from "@/components/ui";
import { LANGUAGES, type Language } from "@/constants/languages";
import { usePermissions } from "@/hooks";
import { useTokens } from "@/hooks/ui";
import { auth$ } from "@/store";
import { AppAlert } from "@/utils";

export interface LanguagePickerSheetProps {
  isVisible: boolean;
  selectedLanguages: string[];
  pinnedLanguages: string[];
  onSelectionChange: (
    selectedLanguages: string[],
    pinnedLanguages: string[],
  ) => void;
  onClose: () => void;
  singleSelect?: boolean;
}

export const LanguagePickerSheet = ({
  isVisible,
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
  onClose,
  singleSelect = false,
}: LanguagePickerSheetProps): React.ReactElement => {
  const { color, spacing } = useTokens();
  const isPro = useSelector(() => auth$.isPro.get());
  const permissions = usePermissions();
  const maxPinnedLanguages = permissions.maxPinnedLanguages;
  const maxSelectedLanguages = permissions.maxSelectedLanguages;
  const [searchQuery, setSearchQuery] = useState("");

  const availableLanguages = useMemo(() => {
    if (isPro) return LANGUAGES;
    return LANGUAGES.filter((l) => !l.proOnly);
  }, [isPro]);

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q === "") return availableLanguages;
    return availableLanguages.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q),
    );
  }, [searchQuery, availableLanguages]);

  const pinnedItems = useMemo(
    () => filteredLanguages.filter((l) => pinnedLanguages.includes(l.code)),
    [filteredLanguages, pinnedLanguages],
  );

  const otherItems = useMemo(
    () => filteredLanguages.filter((l) => !pinnedLanguages.includes(l.code)),
    [filteredLanguages, pinnedLanguages],
  );

  const toggleSelection = (code: string): void => {
    if (singleSelect) {
      onSelectionChange([code], pinnedLanguages);
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
    onSelectionChange(next, pinnedLanguages);
  };

  const togglePin = (code: string): void => {
    const isCurrentlyPinned = pinnedLanguages.includes(code);
    if (!isCurrentlyPinned && pinnedLanguages.length >= maxPinnedLanguages) {
      AppAlert.info(
        "Language Limit Reached",
        `You can only pin up to ${maxPinnedLanguages} languages on your current plan. Upgrade to Pro for more.`,
      );
      return;
    }

    const next = isCurrentlyPinned
      ? pinnedLanguages.filter((c) => c !== code)
      : [...pinnedLanguages, code];
    onSelectionChange(selectedLanguages, next);
  };

  const sections = useMemo(() => {
    const list: {
      title: string;
      data: Language[];
      isPinnedSection: boolean;
    }[] = [];
    if (pinnedItems.length > 0) {
      list.push({ title: "PINNED", data: pinnedItems, isPinnedSection: true });
    }
    list.push({
      title: searchQuery ? "RESULTS" : "ALL LANGUAGES",
      data: otherItems,
      isPinnedSection: false,
    });
    return list;
  }, [pinnedItems, otherItems, searchQuery]);

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
      section,
    }: {
      item: Language;
      section: { data: Language[]; isPinnedSection: boolean };
    }) => (
      <LanguageRow
        code={item.code}
        isSelected={selectedLanguages.includes(item.code)}
        isPinned={section.isPinnedSection}
        onPress={() => toggleSelection(item.code)}
        onTogglePin={() => togglePin(item.code)}
      />
    ),
    [selectedLanguages, toggleSelection, togglePin],
  );

  return (
    <Sheet visible={isVisible} onClose={onClose} maxHeight="90%">
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
          }}
        >
          <Button label="Confirm" onPress={onClose} variant="primary" />
        </Box>
      )}
    </Sheet>
  );
};
