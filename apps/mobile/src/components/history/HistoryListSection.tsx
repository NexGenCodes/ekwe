import { FlashList, type FlashListRef } from "@shopify/flash-list";
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";

import { HistoryEntryRow } from "@/components";
import { Box, Text } from "@/components/ui";
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
  onLoadMore?: () => void;
  handleEntryPress: (entry: HistoryEntry) => void;
  onDeleteEntry: (entryId: string) => void;
}

/**
 * HistoryListSection — Extracted FlashList rendering logic.
 * Manages list rendering, item rendering, footer, and pagination.
 */
export const HistoryListSection = React.memo(function HistoryListSection({
  listRef,
  listData,
  isRefreshing,
  onRefresh,
  isSearching,
  hasMore,
  onLoadMore,
  handleEntryPress,
  onDeleteEntry,
}: HistoryListSectionProps): React.ReactElement {
  const { color } = useTheme();

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

  const listFooter = useCallback(
    () => (
      <Box style={styles.listFooter}>
        {!isSearching && !hasMore && listData.length > 0 ? (
          <Text variant="caption" style={{ color: color.muted }}>
            You&apos;re all caught up
          </Text>
        ) : null}
      </Box>
    ),
    [isSearching, hasMore, listData.length, color.muted],
  );

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
        onEndReached={!isSearching && hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        refreshing={isRefreshing}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
      />
    </Box>
  );
});

const styles = StyleSheet.create({
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
    paddingBottom: spacing["6xl"],
  },
  listFooter: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
});
