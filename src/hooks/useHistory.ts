import { useSelector } from '@legendapp/state/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/services/supabase';
import { Db } from '@/services/db';
import { HistoryEntry, history$ } from '@/store';
import logger from '@/utils/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;

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

function computeSnapshot(record: Record<string, HistoryEntry> | undefined): HistorySnapshot {
  const sorted = Object.values(record || {})
    .filter((entry) => !entry.deleted)
    .sort((a, b) => b.timestamp - a.timestamp);

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
    loadedCountRef.current = Object.values(history$.get() || {}).filter((e) => !e.deleted).length;
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
          deleted: row.deleted === 1,
        });
      }
    }
    loadedCountRef.current += rows.length;
  }, []);

  const deleteEntry = useCallback(async (id: string): Promise<void> => {
    history$[id].deleted.set(true);
    Db.softDeleteHistory(id);
    supabase
      .from('history')
      .update({ deleted: true })
      .eq('id', id)
      .then((res) => {
        if (res.error) logger.error(res.error);
      });
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    const ids = Object.keys(history$.get() || {});
    ids.forEach((id) => {
      history$[id].deleted.set(true);
    });
    Db.softDeleteHistoryBatch(ids);
    supabase
      .from('history')
      .update({ deleted: true })
      .in('id', ids)
      .then((res) => {
        if (res.error) logger.error(res.error);
      });
  }, []);

  return { ...snapshot, deleteEntry, clearAll, loadMore, hasMore };
};
