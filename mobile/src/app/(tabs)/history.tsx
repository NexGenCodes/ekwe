import { triggerHaptic } from "@/utils/haptics";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import { AudioLines, Search, X } from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import { TextInput, ScrollView, StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { type FlashListRef } from "@shopify/flash-list";
import { EmptyState, IconContainer } from "@/components";
import { HistoryListSection } from "@/components/history/HistoryListSection";
import { Box, Text, Pressable } from "@/components/ui";
import { duration, shadows } from "@/constants";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useHistory, useHistoryListData, useHistorySearch, useTheme } from "@/hooks";
import type { ListItem } from "@/hooks/useHistoryListData";
import { HistoryFilterOption } from "@/hooks/useHistorySearch";
import { SyncService } from "@/services/SyncService";
import { HistoryEntry, auth$ } from "@/store";
import { isIOS, logger } from "@/utils";

const FILTER_OPTIONS: HistoryFilterOption[] = [
  "all",
  "transcription",
  "translation",
];

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const {
    entries,
    todayEntries,
    yesterdayEntries,
    earlierEntries,
    deleteEntry,
    loadMore,
    hasMore,
  } = useHistory();
  const { query, setQuery, filter, setFilter, filteredEntries, isSearching } =
    useHistorySearch(entries);
  const [isFocused, setIsFocused] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { color } = useTheme();

  const listRef = useRef<FlashListRef<ListItem>>(null!);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await triggerHaptic();

    const userId = auth$.user.get()?.id;
    if (userId) {
      try {
        await Promise.all([
          SyncService.pullFromCloud(userId),
          SyncService.drain(),
        ]);
      } catch (err) {
        logger.error("[history] Pull to refresh failed:", err);
      }
    }

    setIsRefreshing(false);
  }, []);

  // When searching/filtering, use filteredEntries flat.
  // When browsing, use the date-grouped buckets from useHistory.
  const isGrouped = !isSearching && filter === "all" && query.length === 0;

  const listData = useHistoryListData({
    isGrouped,
    todayEntries,
    yesterdayEntries,
    earlierEntries,
    filteredEntries,
  });

  const handleEntryPress = useCallback(
    (entry: HistoryEntry): void => {
      router.push({
        pathname: "/result",
        params: {
          entryId: entry.id,
          transcript: entry.transcript,
          sourceLang: entry.sourceLang,
          targetLang: entry.targetLang,
          duration: entry.duration,
          isHistoryReplay: "true",
        },
      });
    },
    [router],
  );

  return (
    <Box style={[styles.flex1, { backgroundColor: color.background }]}>
      <Box style={{ paddingHorizontal: spacing.md }}>
        {/* Search row */}
        <Box style={styles.searchRow}>
          <Box
            style={[
              styles.searchContainer,
              {
                backgroundColor: color.card,
                borderColor: isFocused ? color.brand : color.border,
              },
            ]}
          >
            <Search size={iconSize.md} color={color.brand} />
            <TextInput
              style={[
                styles.searchInput,
                typography.bodySmall,
                { color: color.foreground },
              ]}
              placeholder="Search transcripts..."
              placeholderTextColor={color.muted}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => {
                  triggerHaptic();
                  setQuery("");
                }}
                hitSlop={spacing.md}
                style={({ pressed }) => [
                  styles.clearButton,
                  pressed && styles.clearButtonPressed,
                ]}
              >
                <X size={iconSize.sm} color={color.muted} />
              </Pressable>
            )}
          </Box>
        </Box>

        {/* Horizontal scrollable filter chips */}
        <Box style={styles.chipsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {FILTER_OPTIONS.map((option) => (
              <Pressable
                key={option}
                onPress={() => {
                  triggerHaptic();
                  setFilter(option);
                }}
                style={[
                  styles.chip,
                  filter === option
                    ? {
                        backgroundColor: `${color.brand}15`,
                        borderColor: color.brand,
                      }
                    : {
                        backgroundColor: color.card,
                        borderColor: color.border,
                      },
                ]}
              >
                <Text
                  key={option}
                  variant="label"
                  style={[
                    filter === option
                      ? { color: color.brand }
                      : { color: color.foreground },
                  ]}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Box>
      </Box>

      {filteredEntries.length === 0 && listData.length === 0 ? (
        <Animated.View
          entering={FadeIn.duration(duration.normal)}
          style={styles.emptyStateContainer}
        >
          <Box
            style={[
              styles.emptyStateCard,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <EmptyState
              animate
              icon={
                <IconContainer size="lg" backgroundColor={`${color.foreground}15`}>
                  {isIOS ? (
                    <ExpoImage
                      source="sf:clock.fill"
                      style={{ width: iconSize.lg, height: iconSize.lg }}
                      tintColor={color.foreground}
                    />
                  ) : (
                    <AudioLines size={iconSize.lg} color={color.foreground} />
                  )}
                </IconContainer>
              }
              title={query.length > 0 ? "No Matches Found" : "Silent Library"}
              subtitle={
                query.length > 0
                  ? "We couldn't find any transcripts matching your search."
                  : "Your voice note history will appear here."
              }
            />
          </Box>
        </Animated.View>
      ) : (
        <HistoryListSection
          listRef={listRef}
          listData={listData}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
          isSearching={isSearching}
          hasMore={hasMore}
          onLoadMore={loadMore}
          handleEntryPress={handleEntryPress}
          deleteEntry={deleteEntry}
        />
      )}
    </Box>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  searchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    height: spacing["3xl"],
    borderRadius: borderRadius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    boxShadow: shadows.soft,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    paddingVertical: 0,
  },
  clearButton: { padding: spacing.xs },
  clearButtonPressed: { transform: [{ scale: 0.95 }] },
  chipsContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  chipsContent: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  emptyStateContainer: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: spacing["6xl"],
  },
  emptyStateCard: {
    width: "100%",
    padding: spacing["2xl"],
    borderRadius: borderRadius["2xl"],
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
  },
});
