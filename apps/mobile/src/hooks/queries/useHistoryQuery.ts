import { useState, useRef, useCallback, useEffect } from "react";

import { SyncService } from "@/services/syncService";
import { Db, HistoryRow } from "@/services/db";
import { historyRowToEntry } from "@/services/historyMapper";
import { history$, HistoryEntry, sortedHistory$ } from "@/store";
import logger from "@/utils/logger";

const PAGE_SIZE = 20;

export interface HistoryCursor {
  created_at: string;
  id: string;
}

function rowToEntry(row: HistoryRow): HistoryEntry {
  return historyRowToEntry(row);
}

function hydrate(entries: HistoryEntry[]): void {
  for (const e of entries) {
    if (!history$[e.id].peek()) {
      history$[e.id].set(e);
    }
  }
}

function pageCursor(page: HistoryEntry[]): HistoryCursor | null {
  if (page.length < PAGE_SIZE) return null;
  const oldest = page.reduce((a, b) =>
    b.timestamp < a.timestamp || (b.timestamp === a.timestamp && b.id < a.id)
      ? b
      : a,
  );
  return {
    created_at: new Date(oldest.timestamp).toISOString(),
    id: oldest.id,
  };
}

export function useHistoryQuery(userId: string | undefined): {
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  refetch: () => Promise<void>;
} {
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const currentCursor = useRef<HistoryCursor | null>(null);
  const initialFetchDone = useRef(false);

  const fetchPage = useCallback(
    async (cursor: HistoryCursor | null): Promise<HistoryEntry[]> => {
      if (!userId) return [];
      const rows = Db.getHistoryPage(userId, PAGE_SIZE, cursor);

      if (rows.length === 0) {
        const page = await SyncService.fetchOlderHistory(
          userId,
          cursor,
          PAGE_SIZE,
        );
        hydrate(page);
        return page;
      }

      const entries = rows.map(rowToEntry);
      hydrate(entries);

      if (rows.length < PAGE_SIZE) {
        const oldest = entries[entries.length - 1];
        const topUp = await SyncService.fetchOlderHistory(
          userId,
          {
            created_at: new Date(oldest.timestamp).toISOString(),
            id: oldest.id,
          },
          PAGE_SIZE - rows.length,
        );
        hydrate(topUp);
        entries.push(...topUp);
      }

      return entries;
    },
    [userId],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    if (!userId || !hasMore || isFetchingNextPage) return;

    setIsFetchingNextPage(true);
    try {
      const entries = sortedHistory$.peek();
      const cursorToUse =
        currentCursor.current ||
        (entries.length > 0
          ? {
              created_at: new Date(
                entries[entries.length - 1].timestamp,
              ).toISOString(),
              id: entries[entries.length - 1].id,
            }
          : null);

      const page = await fetchPage(cursorToUse);
      const nextCursor = pageCursor(page);
      currentCursor.current = nextCursor;
      setHasMore(nextCursor !== null);
    } catch (err) {
      logger.error("[useHistoryQuery] loadMore failed:", err);
    } finally {
      setIsFetchingNextPage(false);
    }
  }, [userId, hasMore, isFetchingNextPage, fetchPage]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!userId) return;
    currentCursor.current = null;
    setHasMore(true);
    await fetchPage(null);
  }, [userId, fetchPage]);

  // Initial load
  useEffect(() => {
    if (userId && !initialFetchDone.current) {
      initialFetchDone.current = true;
      refetch();
    }
  }, [userId, refetch]);

  return {
    loadMore,
    hasMore,
    isFetchingNextPage,
    refetch,
  };
}
