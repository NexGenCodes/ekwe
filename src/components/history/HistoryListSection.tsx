import { FlashList, type FlashListRef } from "@shopify/flash-list";
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";

import { HistoryItem } from "@/components";
import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";
import type { ListItem } from "@/hooks/useHistoryListData";
import type { HistoryEntry } from "@/store";

export interface HistoryListSectionProps {
  listRef: React.RefObject<FlashListRef<ListItem>>;
  listData: ListItem[];
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  isSearching: boolean;
  hasMore: boolean;
  onLoadMore?: () => void;
  handleEntryPress: (entry: HistoryEntry) => void;
  deleteEntry: (id: string) => void;
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
  deleteEntry,
}: HistoryListSectionProps): React.ReactElement {
  const { color } = useTheme();

  const renderListItem = useCallback(
    ({ item }: { item: ListItem }): React.ReactElement => {
      if (item.type === "header") {
        return (
          <Box style={styles.sectionHeader}>
            <Box
              style={[styles.headerLine, { backgroundColor: color.border }]}
            />
            <Text
              variant="label"
              style={{
                color: color.muted,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                paddingHorizontal: spacing.sm,
              }}
            >
              {item.title}
              <Text
                variant="caption"
                style={{
                  color: color.muted,
                }}
              >
                {" "}
                ({item.count})
              </Text>
            </Text>
            <Box
              style={[styles.headerLine, { backgroundColor: color.border }]}
            />
          </Box>
        );
      }
      return (
        <Box style={styles.entryContainer}>
          <HistoryItem
            entry={item.entry}
            onPress={handleEntryPress}
            onDelete={deleteEntry}
          />
        </Box>
      );
    },
    [handleEntryPress, deleteEntry, color.border, color.muted],
  );

  const listFooter = useCallback(
    () => (
      <Box style={styles.listFooter}>
        {!isSearching && !hasMore && listData.length > 0 ? (
          <Text variant="caption" style={{ color: color.muted }}>
            That's everything, chief.
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerLine: {
    flex: 1,
    height: 1,
    opacity: 0.3,
  },
  entryContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
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
