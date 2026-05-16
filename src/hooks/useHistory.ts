import { useSelector } from '@legendapp/state/react';
import { useMemo } from 'react';

import { HistoryEntry, history$ } from '@/store';
import { supabase } from '@/services/supabase';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
  earlierEntries: HistoryEntry[];
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useHistory = (): UseHistoryReturn => {
  // Read all history entries from the local MMKV state
  const historyRecord = useSelector(() => history$.get());

  // Convert the Record<string, HistoryEntry> into an array, filter out deleted items, and sort newest first
  const entries: HistoryEntry[] = useMemo(() => {
    return Object.values(historyRecord || {})
      .filter((entry) => !entry.deleted)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [historyRecord]);

  // Section by calendar day
  const { todayEntries, yesterdayEntries, earlierEntries } = useMemo(() => {
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart - MS_PER_DAY;
    return {
      todayEntries: entries.filter((e) => e.timestamp >= todayStart),
      yesterdayEntries: entries.filter(
        (e) => e.timestamp >= yesterdayStart && e.timestamp < todayStart,
      ),
      earlierEntries: entries.filter((e) => e.timestamp < yesterdayStart),
    };
  }, [entries]);

  // Perform a "soft delete" to ensure offline sync knows it was deleted
  const deleteEntry = async (id: string): Promise<void> => {
    history$[id].deleted.set(true);
    supabase.from('history').update({ deleted: true }).eq('id', id).then((res) => {
      if (res.error) console.error(res.error);
    });
  };

  const clearAll = async (): Promise<void> => {
    const ids = Object.keys(historyRecord || {});
    // Perform bulk soft-delete locally
    ids.forEach((id) => {
      history$[id].deleted.set(true);
    });
    supabase.from('history').update({ deleted: true }).in('id', ids).then((res) => {
      if (res.error) console.error(res.error);
    });
  };

  return {
    entries,
    todayEntries,
    yesterdayEntries,
    earlierEntries,
    deleteEntry,
    clearAll,
  };
};
