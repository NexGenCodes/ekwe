import { useSelector } from "@legendapp/state/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SyncService } from "@/services/SyncService";
import { Db } from "@/services/db";
import { HistoryEntry, history$, auth$ } from "@/store";
import logger from "@/utils/logger";
import { AppToast } from "@/utils/toast";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
  thisWeekEntries: HistoryEntry[];
  earlierEntries: HistoryEntry[];
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

interface HistorySnapshot {
  entries: HistoryEntry[];
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
  thisWeekEntries: HistoryEntry[];
  earlierEntries: HistoryEntry[];
}

function computeSnapshot(
  record: Record<string, HistoryEntry> | undefined,
): HistorySnapshot {
  const sorted = Object.values(record || {}).sort(
    (a, b) => b.timestamp - a.timestamp,
  );

  const todayStart = new Date().setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - MS_PER_DAY;
  const thisWeekStart = todayStart - 7 * MS_PER_DAY;

  const todayEntries: HistoryEntry[] = [];
  const yesterdayEntries: HistoryEntry[] = [];
  const thisWeekEntries: HistoryEntry[] = [];
  const earlierEntries: HistoryEntry[] = [];

  for (const e of sorted) {
    if (e.timestamp >= todayStart) todayEntries.push(e);
    else if (e.timestamp >= yesterdayStart) yesterdayEntries.push(e);
    else if (e.timestamp >= thisWeekStart) thisWeekEntries.push(e);
    else earlierEntries.push(e);
  }

  return {
    entries: sorted,
    todayEntries,
    yesterdayEntries,
    thisWeekEntries,
    earlierEntries,
  };
}

export const useHistory = (): UseHistoryReturn => {
  const snapshot = useSelector(() => computeSnapshot(history$.get()));
  const [hasMore, setHasMore] = useState(true);
  const loadingRef = useRef(false);

  useEffect(() => {
    // Signed out → nothing more to load. Signed in with a fresh, empty list →
    // optimistically allow loading; `loadMore` resolves the real answer (more
    // local rows, older cloud rows, or none).
    const userId = auth$.user.get()?.id;
    if (!userId) {
      setHasMore(false);
    } else if (snapshot.entries.length === 0) {
      setHasMore(true);
    }
  }, [snapshot.entries.length]);

  const loadMore = useCallback(async () => {
    const userId = auth$.user.get()?.id;
    if (!userId) {
      setHasMore(false);
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      // Oldest entry currently shown — the (created_at, id) cursor for the
      // next page. Cloud pulls insert rows into SQLite, so paging must be
      // cursor-based, not OFFSET-based, or sync would shift the offset and
      // skip/duplicate rows.
      const record = history$.get() || {};
      let oldest: HistoryEntry | null = null;
      for (const key of Object.keys(record)) {
        const e = record[key];
        if (
          !oldest ||
          e.timestamp < oldest.timestamp ||
          (e.timestamp === oldest.timestamp && e.id < oldest.id)
        ) {
          oldest = e;
        }
      }
      const before = oldest
        ? {
            created_at: new Date(oldest.timestamp).toISOString(),
            id: oldest.id,
          }
        : null;

      // 1) Continue paging the local SQLite window (7-day TTL) first.
      const rows = Db.getHistoryPage(userId, PAGE_SIZE, before);
      if (rows.length > 0) {
        for (const row of rows) {
          if (!history$[row.id].get()) {
            history$[row.id].set({
              id: row.id,
              sourceLang: row.source_lang,
              targetLang: row.target_lang,
              transcript: row.transcript,
              translation: row.translation_text,
              transliteration: row.transliteration_text,
              duration: row.duration,
              sourceApp: row.source_app,
              provider: row.provider,
              timestamp: new Date(row.created_at).getTime(),
              type: row.entry_type ?? "transcription",
            });
          }
        }
        setHasMore(rows.length === PAGE_SIZE);
        return;
      }

      // 2) Local window exhausted → page OLDER rows from the cloud for
      //    display only (they're beyond the local TTL; never cached to SQLite).
      if (!oldest) {
        setHasMore(false);
        return;
      }

      const page = await SyncService.fetchOlderHistory(
        userId,
        {
          created_at: new Date(oldest.timestamp).toISOString(),
          id: oldest.id,
        },
        PAGE_SIZE,
      );
      if (page.length === 0) {
        setHasMore(false);
        return;
      }
      for (const e of page) {
        if (!history$[e.id].get()) history$[e.id].set(e);
      }
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  const deleteEntry = useCallback(async (id: string): Promise<void> => {
    const userId = auth$.user.get()?.id;
    if (!userId) {
      logger.warn("[useHistory] Cannot delete entry: no authenticated user");
      return;
    }
    const entry = history$[id].get();
    if (!entry) return;

    await SyncService.deleteHistory(id, userId);

    AppToast.success("Entry deleted", {
      haptics: false,
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          SyncService.restoreHistory(entry, userId).catch((err) =>
            logger.error("[useHistory] Undo restore failed", err),
          );
        },
      },
    });
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    const userId = auth$.user.get()?.id;
    if (!userId) {
      logger.warn("[useHistory] Cannot clear entries: no authenticated user");
      return;
    }
    await SyncService.clearAllHistory(userId);
  }, []);

  return { ...snapshot, deleteEntry, clearAll, loadMore, hasMore };
};
