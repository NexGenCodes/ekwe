import { useMemo } from "react";

import type { HistoryEntry } from "@/store";

type ListItem =
  | { type: "header"; title: string; count: number }
  | { type: "entry"; entry: HistoryEntry };

interface UseHistoryListDataProps {
  isGrouped: boolean;
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
  thisWeekEntries: HistoryEntry[];
  earlierEntries: HistoryEntry[];
  filteredEntries: HistoryEntry[];
}

/**
 * Computes and groups history entries into display list items.
 * Handles both grouped (by date) and filtered (search) views.
 */
export function useHistoryListData({
  isGrouped,
  todayEntries,
  yesterdayEntries,
  thisWeekEntries,
  earlierEntries,
  filteredEntries,
}: UseHistoryListDataProps): ListItem[] {
  return useMemo((): ListItem[] => {
    if (isGrouped) {
      const result: ListItem[] = [];
      const buckets: { title: string; count: number; data: HistoryEntry[] }[] =
        [
          { title: "Today", count: todayEntries.length, data: todayEntries },
          {
            title: "Yesterday",
            count: yesterdayEntries.length,
            data: yesterdayEntries,
          },
          {
            title: "This Week",
            count: thisWeekEntries.length,
            data: thisWeekEntries,
          },
          {
            title: "Earlier",
            count: earlierEntries.length,
            data: earlierEntries,
          },
        ];
      for (const bucket of buckets) {
        if (bucket.data.length === 0) continue;
        result.push({
          type: "header",
          title: bucket.title,
          count: bucket.count,
        });
        for (const e of bucket.data) {
          result.push({ type: "entry", entry: e });
        }
      }
      return result;
    }
    return filteredEntries.map((e) => ({ type: "entry" as const, entry: e }));
  }, [
    isGrouped,
    todayEntries,
    yesterdayEntries,
    thisWeekEntries,
    earlierEntries,
    filteredEntries,
  ]);
}

export type { ListItem };
