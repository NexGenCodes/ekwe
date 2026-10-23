import { useState, useRef, useCallback, useEffect } from "react";

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
  isInitialLoading: boolean;
  refetch: () => Promise<void>;
} {
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const currentCursor = useRef<HistoryCursor | null>(null);
  const fetchedForUser = useRef<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: HistoryCursor | null): Promise<HistoryEntry[]> => {
      if (!userId) return [];
      const entries = Db.getHistoryPage(userId, PAGE_SIZE, cursor).map(
        rowToEntry,
      );
      hydrate(entries);
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
    setIsInitialLoading(true);
    try {
      const page = await fetchPage(null);
      const nextCursor = pageCursor(page);
      currentCursor.current = nextCursor;
      setHasMore(nextCursor !== null);
    } finally {
      setIsInitialLoading(false);
    }
  }, [userId, fetchPage]);

  useEffect(() => {
    if (!userId) {
      fetchedForUser.current = null;
      return;
    }
    if (fetchedForUser.current === userId) return;
    fetchedForUser.current = userId;
    void refetch();
  }, [userId, refetch]);

  return {
    loadMore,
    hasMore,
    isFetchingNextPage,
    isInitialLoading,
    refetch,
  };
}
