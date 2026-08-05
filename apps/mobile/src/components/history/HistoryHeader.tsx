import * as Haptics from "expo-haptics";
import Search from "lucide-react-native/icons/search";
import X from "lucide-react-native/icons/x";
import Filter from "lucide-react-native/icons/funnel";
import React, { useCallback } from "react";
import { TextInput, StyleSheet } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";
import type { HistoryFilterOption } from "@/hooks/useHistorySearch";
import type { HistoryEntry } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

const FILTER_OPTIONS: HistoryFilterOption[] = [
  "all",
  "transcription",
  "translation",
];

export interface HistoryHeaderProps {
  query: string;
  setQuery: (q: string) => void;
  filter: HistoryFilterOption;
  setFilter: (f: HistoryFilterOption) => void;
  isSearching: boolean;
  filteredEntries: HistoryEntry[];
  hasResults: boolean;
  entries: HistoryEntry[];
  clearAll: () => void;
}

/**
 * HistoryHeader — Search, filter, and header UI for history screen.
 * Manages search input, filter chips, and clear all button.
 */
export const HistoryHeader = React.memo(function HistoryHeader({
  query,
  setQuery,
  filter,
  setFilter,
  isSearching,
  filteredEntries,
  hasResults,
  entries,
  clearAll,
}: HistoryHeaderProps): React.ReactElement {
  const { color } = useTheme();
  const [isFocused, setIsFocused] = React.useState(false);

  const handleClearAll = useCallback(() => {
    triggerHaptic(Haptics.NotificationFeedbackType.Warning);
    clearAll();
  }, [clearAll]);

  const handleClearQuery = useCallback(() => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    setQuery("");
  }, [setQuery]);

  const handleFilterSelect = useCallback(
    (option: HistoryFilterOption) => {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
      setFilter(option);
    },
    [setFilter],
  );

  return (
    <Box style={styles.headerSection}>
      {entries.length > 0 && (
        <Box style={styles.clearRow}>
          <Pressable
            onPress={handleClearAll}
            feedback="scale"
            hitSlop={spacing.sm}
          >
            <Text variant="caption" style={{ color: color.error }}>
              Clear All
            </Text>
          </Pressable>
        </Box>
      )}

      <Box
        style={[
          styles.searchBar,
          {
            backgroundColor: color.card,
            borderColor: isFocused ? color.brand : color.border,
          },
        ]}
      >
        <Search
          size={iconSize.sm}
          color={isFocused ? color.brand : color.muted}
        />
        <TextInput
          style={[styles.searchInput, { color: color.foreground }]}
          placeholder="Search transcripts..."
          placeholderTextColor={color.disabled}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {query.length > 0 && (
          <Pressable
            onPress={handleClearQuery}
            hitSlop={spacing.sm}
            feedback="scale"
          >
            <X size={iconSize.xs} color={color.muted} />
          </Pressable>
        )}
      </Box>

      <Box style={styles.chipsRow}>
        {FILTER_OPTIONS.map((option) => {
          const isActive = filter === option;
          return (
            <Pressable
              key={option}
              onPress={() => handleFilterSelect(option)}
              feedback="scale"
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? `${color.brand}12` : color.card,
                  borderColor: isActive ? color.brand : color.border,
                },
              ]}
            >
              {option === "all" && (
                <Filter
                  size={12}
                  color={isActive ? color.brand : color.muted}
                />
              )}
              <Text
                variant="caption"
                style={{
                  color: isActive ? color.brand : color.muted,
                  fontWeight: isActive ? "600" : "400",
                }}
              >
                {option === "all"
                  ? `${option.charAt(0).toUpperCase() + option.slice(1)} (${entries.length})`
                  : option.charAt(0).toUpperCase() + option.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </Box>

      {isSearching && hasResults && (
        <Text variant="caption" style={{ color: color.muted }}>
          {filteredEntries.length}{" "}
          {filteredEntries.length === 1 ? "result" : "results"}
        </Text>
      )}
    </Box>
  );
});

const styles = StyleSheet.create({
  headerSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  clearRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    height: spacing["3xl"],
    borderRadius: borderRadius["2xl"],
    borderWidth: 1,
    gap: spacing.sm,
    boxShadow: shadows.soft,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
    fontFamily: "Outfit-Regular",
  },
  chipsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
});
