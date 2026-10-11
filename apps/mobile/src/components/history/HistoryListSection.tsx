import { FlashList, type FlashListRef } from "@shopify/flash-list";
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";

import { useTabBarTotalHeight } from "@/components/CustomTabBar";
import { HistoryEntryRow } from "@/components";
import { Box, Text, Spinner } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";
import type { ListItem } from "@/hooks/useHistoryListData";
import type { HistoryEntry } from "@/store";
import { withAlpha } from "@/utils/color";

export interface HistoryListSectionProps {
  listRef: React.RefObject<FlashListRef<ListItem>>;
  listData: ListItem[];
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  isSearching: boolean;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  isInitialLoading?: boolean;
  onLoadMore?: () => void;
  handleEntryPress: (entry: HistoryEntry) => void;
  onDeleteEntry: (entryId: string) => void;
}

export const HistoryListSection = React.memo(function HistoryListSection({
  listRef,
  listData,
  isRefreshing,
  onRefresh,
  isSearching,
  hasMore,
  isFetchingNextPage,
  isInitialLoading = false,
  onLoadMore,
  handleEntryPress,
  onDeleteEntry,
}: HistoryListSectionProps): React.ReactElement {
  const { color } = useTheme();
  const tabBarHeight = useTabBarTotalHeight();

  const renderListItem = useCallback(
    ({ item }: { item: ListItem }): React.ReactElement => {
      if (item.type === "header") {
        return (
          <Box style={styles.sectionHeader}>
            <Text
              variant="label"
              style={{
                color: color.muted,
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              {item.title}
            </Text>
            <Box
              style={[
                styles.countPill,
                { backgroundColor: withAlpha(color.foreground, 0.08) },
              ]}
            >
              <Text variant="caption" style={{ color: color.muted }}>
                {item.count}
              </Text>
            </Box>
            <Box
              style={[styles.headerLine, { backgroundColor: color.border }]}
            />
          </Box>
        );
      }
      return (
        <Box style={styles.entryContainer}>
          <HistoryEntryRow
            entry={item.entry}
            onPress={handleEntryPress}
            onDelete={onDeleteEntry}
          />
        </Box>
      );
    },
    [
      handleEntryPress,
      onDeleteEntry,
      color.border,
      color.muted,
      color.foreground,
    ],
  );

  const listFooter = useCallback(() => {
    if (isSearching) return null;

    if (isFetchingNextPage) {
      return (
        <Box style={styles.listFooter}>
          <Spinner size="sm" color={color.muted} />
          <Text variant="caption" style={{ color: color.muted }}>
            Loading older entries…
          </Text>
        </Box>
      );
    }

    if (!hasMore && listData.length > 0) {
      return (
        <Box style={styles.listFooter}>
          <Text variant="caption" style={{ color: color.muted }}>
            You&apos;re all caught up
          </Text>
        </Box>
      );
    }

    return null;
  }, [isSearching, isFetchingNextPage, hasMore, listData.length, color.muted]);

  return (
    <Box style={styles.listContainer}>
      <FlashList<ListItem>
        ref={listRef}
        data={listData}
        renderItem={renderListItem}
        keyExtractor={(item, index) =>
          item.type === "header"
            ? `header-${item.title}`
            : `entry-${item.entry.id || index}`
        }
        getItemType={(item) => item.type}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          isInitialLoading ? <HistorySkeleton color={color} /> : null
        }
        onEndReached={!isSearching && hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        refreshing={isRefreshing}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: tabBarHeight + spacing.xl },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      />
    </Box>
  );
});

const SKELETON_ROWS = 6;

function HistorySkeleton({
  color,
}: {
  color: ReturnType<typeof useTheme>["color"];
}): React.ReactElement {
  const surface = withAlpha(color.foreground, 0.06);
  const muted = withAlpha(color.foreground, 0.04);

  return (
    <Box
      accessibilityRole="progressbar"
      accessibilityLabel="Loading history"
      style={styles.skeletonContainer}
    >
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Box
          key={index}
          style={[
            styles.skeletonRow,
            { backgroundColor: surface, borderColor: color.border },
          ]}
        >
          <Box style={[styles.skeletonIcon, { backgroundColor: muted }]} />
          <Box style={{ flex: 1, gap: spacing.sm }}>
            <Box
              style={[
                styles.skeletonLine,
                { backgroundColor: muted, width: "72%" },
              ]}
            />
            <Box
              style={[
                styles.skeletonLine,
                { backgroundColor: muted, width: "45%" },
              ]}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

const styles = StyleSheet.create({
  skeletonContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
  },
  skeletonLine: {
    height: 10,
    borderRadius: borderRadius.full,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  countPill: {
    minWidth: 22,
    height: 18,
    borderRadius: borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  headerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  entryContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: 12,
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingTop: spacing.sm,
  },
  listFooter: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    flexDirection: "row",
    justifyContent: "center",
  },
});
