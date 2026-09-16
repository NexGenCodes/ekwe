import { useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { SyncService } from "@/services/SyncService";
import { Db, HistoryRow } from "@/services/db";
import { history$, HistoryEntry, EntryType } from "@/store";

const PAGE_SIZE = 20;

export interface HistoryCursor {
  created_at: string;
  id: string;
}

export const historyQueryKey = (userId: string): string[] =>
  ["history", userId] as const;

function rowToEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    transcript: row.transcript,
    translation: row.translationText,
    transliteration: row.transliterationText,
    duration: row.duration,
    sourceApp: row.sourceApp,
    provider: row.provider,
    timestamp: new Date(row.createdAt).getTime(),
    type: (row.entryType as EntryType) ?? "transcription",
  };
}

function hydrate(entries: HistoryEntry[]): void {
  for (const e of entries) {
    if (!history$[e.id].get()) history$[e.id].set(e);
  }
}

async function fetchHistoryPage(
  userId: string,
  pageParam: HistoryCursor | null,
): Promise<HistoryEntry[]> {
  // 1) Continue paging the local SQLite window (7-day TTL) first.
  const rows = Db.getHistoryPage(userId, PAGE_SIZE, pageParam);
  if (rows.length === 0) {
    // Nothing cached locally → page the cloud directly. A null cursor means
    // "newest page", which covers the fresh-install / 7-day-window-drained
    // case where there is no local row to seed the cursor from — otherwise
    // cloud-only history would never load. Empty cloud ⇒ truly done.
    const page = await SyncService.fetchOlderHistory(
      userId,
      pageParam,
      PAGE_SIZE,
    );
    hydrate(page);
    return page;
  }

  const entries = rows.map(rowToEntry);
  hydrate(entries);

  // 2) The TTL window shrank mid-pagination: the local cache only holds ~7
  //    days of history, so a short page here just means the cache ran out,
  //    not the history. Top the page up from the cloud so the cursor can
  //    keep advancing into older rows.
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
}

function pageCursor(page: HistoryEntry[]): HistoryCursor | null {
  // A fully-packed page means there may be more; only then derive a cursor
  // from its oldest entry (normalized like the cloud `(created_at, id)` key).
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

/**
 * Cursor-paginated access to the full history (local 7-day window, then cloud).
 *
 * The query owns pagination bookkeeping — in-flight tracking, deduping of
 * concurrent loads, and `hasNextPage` — while each page hydrates `history$`,
 * which remains the live store the list renders from. This mirrors the old
 * hand-rolled `loadMore` mutex with react-query's fetch-state machinery.
 */
export function useHistoryQuery(userId: string | undefined): {
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  refetch: () => Promise<void>;
} {
  // Mutex: react-query batches synchronous state updates, so a burst of
  // same-tick loadMore calls could each see isFetchingNextPage as false.
  const inFlightRef = useRef<boolean>(false);
  const query = useInfiniteQuery<
    HistoryEntry[],
    Error,
    HistoryEntry[],
    string[],
    HistoryCursor | null
  >({
    queryKey: userId ? historyQueryKey(userId) : ["history", "unauthenticated"],
    queryFn: ({ pageParam }) =>
      userId ? fetchHistoryPage(userId, pageParam) : [],
    initialPageParam: null,
    getNextPageParam: (lastPage) => pageCursor(lastPage),
    enabled: !!userId,
    // Local SQLite paging must work offline; only the cloud tier needs the
    // network (fetchOlderHistory already fails soft there).
    networkMode: "offlineFirst",
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    loadMore: async (): Promise<void> => {
      if (
        !inFlightRef.current &&
        query.hasNextPage &&
        !query.isFetchingNextPage
      ) {
        inFlightRef.current = true;
        try {
          await query.fetchNextPage();
        } finally {
          inFlightRef.current = false;
        }
      }
    },
    hasMore: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
