import { useObserveEffect } from '@legendapp/state/react';
import { useCallback, useState } from 'react';

import { supabase } from '@/services/supabase';
import { HistoryEntry, history$ } from '@/store';
import logger from '@/utils/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
  earlierEntries: HistoryEntry[];
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
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

function snapshotChanged(a: HistorySnapshot, b: HistorySnapshot): boolean {
  const len = a.entries.length;
  if (len !== b.entries.length) return true;
  for (let i = 0; i < len; i++) {
    if (a.entries[i].id !== b.entries[i].id) return true;
    if (a.entries[i].timestamp !== b.entries[i].timestamp) return true;
    if (a.entries[i].deleted !== b.entries[i].deleted) return true;
  }
  return false;
}

export const useHistory = (): UseHistoryReturn => {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(() =>
    computeSnapshot(history$.get()),
  );

  useObserveEffect(() => {
    const next = computeSnapshot(history$.get());
    setSnapshot((prev) => (snapshotChanged(prev, next) ? next : prev));
  });

  const deleteEntry = useCallback(async (id: string): Promise<void> => {
    history$[id].deleted.set(true);
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
    supabase
      .from('history')
      .update({ deleted: true })
      .in('id', ids)
      .then((res) => {
        if (res.error) logger.error(res.error);
      });
  }, []);

  return { ...snapshot, deleteEntry, clearAll };
};
