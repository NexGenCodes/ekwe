import { triggerHaptic } from "@/utils/haptics";
import { pushOnce } from "@/utils/navigation";
import { useRouter } from "expo-router";
import { useValue } from "@legendapp/state/react";
import Search from "lucide-react-native/icons/search";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useMemo, useRef, useState } from "react";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { TextInput, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ORIGIN_META } from "@ekwe/shared";

import { type FlashListRef } from "@shopify/flash-list";
import { EkweLogo } from "@/components/EkweLogo";
import { IconContainer } from "@/components";
import { HistoryListSection } from "@/components/history/HistoryListSection";
import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius, iconSize, touchTarget } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import {
  useHistory,
  useHistoryListData,
  useHistorySearch,
  useTheme,
} from "@/hooks";
import type { ListItem } from "@/hooks/useHistoryListData";
import { HistoryFilterOption } from "@/hooks/useHistorySearch";
import { SyncService } from "@/services/syncService";
import { HistoryEntry, auth$ } from "@/store";
import { withAlpha } from "@/utils/color";
import { logger } from "@/utils";

const FILTER_OPTIONS: HistoryFilterOption[] = [
  "all",
  "speech-studio",
  "echo",
  "orb",
];

const FILTER_LABELS: Record<HistoryFilterOption, string> = {
  all: "All",
  "speech-studio": ORIGIN_META["speech-studio"].label,
  echo: ORIGIN_META.echo.label,
  orb: ORIGIN_META.orb.label,
};

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const {
    entries,
    loadMore,
    hasMore,
    isFetchingNextPage,
    isInitialLoading,
    deleteEntry,
    refetch: refetchHistory,
  } = useHistory();
  const {
    query,
    setQuery,
    filter,
    setFilter,
    filteredEntries,
    isSearching,
    isSearchPending,
  } = useHistorySearch(entries);
  const [isFocused, setIsFocused] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { color } = useTheme();

  const listRef = useRef<FlashListRef<ListItem>>(null);
  const insets = useSafeAreaInsets();

  const hasPullError = useValue(() => SyncService.pullError.get() !== null);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await triggerHaptic();

    const userId = auth$.user.get()?.id;
    if (userId) {
      try {
        await Promise.all([
          SyncService.pullFromCloud(userId),
          SyncService.pushPending(),
        ]);

        await refetchHistory();
      } catch (err) {
        logger.error("[history] Pull to refresh failed:", err);
      }
    }

    setIsRefreshing(false);
  }, [refetchHistory]);

  const isGrouped = !isSearching && query.length === 0;

  /**
   * An empty filter should explain itself. "No matches" is only true when a
   * search is running; an origin filter that matches nothing is telling the
   * user something about that surface, not about their query.
   */
  const { emptyTitle, emptySubtitle } = useMemo(() => {
    if (query.trim().length > 0) {
      return {
        emptyTitle: "No Matches Found",
        emptySubtitle: "We couldn't find any transcripts matching your search.",
      };
    }
    if (filter !== "all") {
      return {
        emptyTitle: `No ${ORIGIN_META[filter].label} Captures`,
        emptySubtitle: `${ORIGIN_META[filter].description}. Nothing has been captured here yet.`,
      };
    }
    return {
      emptyTitle: "Silent Library",
      emptySubtitle:
        "Everything you record, share, or capture with Ekwe shows up here.",
    };
  }, [query, filter]);

  const listData = useHistoryListData({
    isGrouped,
    entries,
    filteredEntries,
  });

  const handleEntryPress = useCallback(
    (entry: HistoryEntry): void => {
      pushOnce(router, {
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
      <Box
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.md,
        }}
      >
        <Box style={styles.headerRow}>
          <Box style={styles.headerTitle}>
            <IconContainer
              size="xl"
              variant="custom"
              backgroundColor={withAlpha(color.brand, 0.082)}
            >
              <EkweLogo size={iconSize.xl} color={color.brand} />
            </IconContainer>
            <Box>
              <Text variant="display">History</Text>
            </Box>
          </Box>
        </Box>

        {hasPullError ? (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            layout={LinearTransition.springify().damping(18).stiffness(200)}
          >
            <Box
              style={[
                styles.syncErrorBanner,
                {
                  backgroundColor: withAlpha(color.error, 0.08),
                  borderColor: withAlpha(color.error, 0.25),
                },
              ]}
            >
              <Text
                variant="caption"
                numberOfLines={2}
                style={[styles.syncErrorText, { color: color.error }]}
              >
                Couldn't sync with cloud. Your history is still saved on this
                device.
              </Text>
              <Pressable
                onPress={onRefresh}
                hitSlop={spacing.sm}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text
                  variant="caption"
                  style={{ color: color.brand, fontWeight: "600" }}
                >
                  Retry
                </Text>
              </Pressable>
            </Box>
          </Animated.View>
        ) : null}

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
            {isSearchPending ? (
              <Spinner size="sm" color={color.brand} />
            ) : (
              <Search size={iconSize.md} color={color.brand} />
            )}
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
                accessibilityLabel="Clear search"
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
                accessibilityRole="tab"
                accessibilityState={{ selected: filter === option }}
                style={[
                  styles.chip,
                  filter === option
                    ? {
                        backgroundColor: withAlpha(color.brand, 0.082),
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
                  {FILTER_LABELS[option]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Box>
      </Box>

      <HistoryListSection
        listRef={listRef}
        listData={listData}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        isInitialLoading={isInitialLoading}
        isSearchPending={isSearchPending}
        isSearching={isSearching}
        emptyTitle={emptyTitle}
        emptySubtitle={emptySubtitle}
        hasMore={hasMore}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={loadMore}
        handleEntryPress={handleEntryPress}
        onDeleteEntry={deleteEntry}
        onEmptyAction={
          filter === "all" && !isSearching && query.length === 0
            ? (): void => router.navigate("/(tabs)/")
            : undefined
        }
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  syncErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  syncErrorText: {
    flex: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
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
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
  },
  chip: {
    minHeight: touchTarget.minimum,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
});
