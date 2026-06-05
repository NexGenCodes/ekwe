import { Sheet } from "./ui/Sheet";
import { useSelector } from "@legendapp/state/react";
import { Search, Star, X, Check } from "lucide-react-native";
import React, {
  useMemo,
  useState,
  useCallback,
} from "react";
import {
  SectionList,
  TextInput,
} from "react-native";

import { Button } from "./Button";

import { Box, Pressable, Text } from "@/components/ui";
import { LANGUAGES, Language, FLAG_MAP } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme, usePermissions } from "@/hooks";
import { auth$ } from "@/store";
import { AppAlert } from "@/utils";

interface LanguageRowProps {
  item: Language;
  isSelected: boolean;
  isPinned: boolean;
  onToggleSelect: () => void;
  onTogglePin: () => void;
}

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

const LanguageRow = ({
  item,
  isSelected,
  isPinned,
  onToggleSelect,
  onTogglePin,
}: LanguageRowProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Pressable
      onPress={onToggleSelect}
      style={{
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        backgroundColor: color.background,
      }}
    >
      <Box style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        <Text variant="body" style={{ marginRight: spacing.md }}>
          {FLAG_MAP[item.code] || "🌐"}
        </Text>
        <Box>
          <Text variant="body">{item.englishName}</Text>
          <Text variant="caption" style={{ marginTop: spacing.xs, color: color.muted }}>
            {item.nativeName}
          </Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable
          onPress={onTogglePin}
          hitSlop={8}
          style={{ padding: spacing.sm }}
        >
          <Star
            size={20}
            color={isPinned ? color.secondary : color.muted}
            fill={isPinned ? color.secondary : "transparent"}
          />
        </Pressable>

        <Box
          style={[
            {
              width: 22,
              height: 22,
              borderRadius: borderRadius.lg,
              marginLeft: spacing.md,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
            },
            isSelected
              ? { backgroundColor: color.secondary, borderWidth: 0 }
              : { backgroundColor: "transparent", borderColor: color.border },
          ]}
        >
          {isSelected && (
            <Check size={12} color={color.onSecondary} strokeWidth={3} />
          )}
        </Box>
      </Box>
    </Pressable>
  );
};

export const LanguagePickerSheet = ({
  isVisible,
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
  onClose,
  singleSelect = false,
}: LanguagePickerSheetProps): React.ReactElement => {
  const { color } = useTheme();
  const isPro = useSelector(() => auth$.isPro.get());
  const permissions = usePermissions();
  const maxPinnedLanguages = permissions.maxPinnedLanguages;
  const maxSelectedLanguages = permissions.maxSelectedLanguages;
  const [searchQuery, setSearchQuery] = useState("");

  const mutedColor = color.muted;

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
        <Text
          variant="caption"
          style={{
            color: color.muted,
          }}
        >
          {section.title}
        </Text>
      </Box>
    ),
    [color],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: Language; section: { data: Language[]; isPinnedSection: boolean } }) => (
      <LanguageRow
        item={item}
        isSelected={selectedLanguages.includes(item.code)}
        isPinned={section.isPinnedSection}
        onToggleSelect={() => toggleSelection(item.code)}
        onTogglePin={() => togglePin(item.code)}
      />
    ),
    [selectedLanguages, toggleSelection, togglePin],
  );

  return (
    <Sheet visible={isVisible} onClose={onClose} maxHeight="90%">
      {/* Search */}
      <Box style={{ zIndex: 1, backgroundColor: color.background }}>
        <Box
          style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}
        >
          <Box
            style={[
              {
                height: 44,
                borderWidth: 0.5,
                borderRadius: borderRadius.lg,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: spacing.md,
              },
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <Search
              size={18}
              color={mutedColor}
              style={{ marginRight: spacing.sm }}
            />
            <TextInput
              style={[
                { flex: 1, height: 44, ...typography.body },
                { color: color.foreground },
              ]}
              placeholder="Search languages"
              placeholderTextColor={mutedColor}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <X size={16} color={mutedColor} />
              </Pressable>
            )}
          </Box>
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
