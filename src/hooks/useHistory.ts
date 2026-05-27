import { useSelector } from '@legendapp/state/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SyncService } from '@/services/SyncService';
import { Db } from '@/services/db';
import { HistoryEntry, history$, auth$ } from '@/store';
import logger from '@/utils/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
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

  const todayEntries: HistoryEntry[] = [];
  const yesterdayEntries: HistoryEntry[] = [];
  const earlierEntries: HistoryEntry[] = [];

  for (const e of sorted) {
    if (e.timestamp >= todayStart) todayEntries.push(e);
    else if (e.timestamp >= yesterdayStart) yesterdayEntries.push(e);
    else earlierEntries.push(e);
  }

  return { entries: sorted, todayEntries, yesterdayEntries, earlierEntries };
}

export const useHistory = (): UseHistoryReturn => {
  const snapshot = useSelector(() => computeSnapshot(history$.get()));
  const [hasMore, setHasMore] = useState(true);
  const loadedCountRef = useRef(0);

  useEffect(() => {
    const currentCount = Object.values(history$.get() || {}).length;
    loadedCountRef.current = currentCount;
    setHasMore(currentCount < Db.getHistoryCount());
  }, [snapshot.entries.length]);

  const loadMore = useCallback(async () => {
    const rows = Db.getHistoryPage(PAGE_SIZE, loadedCountRef.current);
    if (rows.length < PAGE_SIZE) {
      setHasMore(false);
    }
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
        });
      }
    }
    loadedCountRef.current += rows.length;
  }, []);

  const deleteEntry = useCallback(async (id: string): Promise<void> => {
    const userId = auth$.user.get()?.id;
    if (!userId) {
      logger.warn('[useHistory] Cannot delete entry: no authenticated user');
      return;
    }
    await SyncService.deleteHistory(id, userId);
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    const userId = auth$.user.get()?.id;
    if (!userId) {
      logger.warn('[useHistory] Cannot clear entries: no authenticated user');
      return;
    }
    const ids = Object.keys(history$.get() || {});
    await SyncService.deleteHistoryBatch(ids, userId);
  }, []);

  return { ...snapshot, deleteEntry, clearAll, loadMore, hasMore };
};
