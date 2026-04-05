import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useHistoryStore, useSettingsStore } from 'src/store';
import { HistoryEntry } from 'src/store/historySlice';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  todayEntries: HistoryEntry[];
  yesterdayEntries: HistoryEntry[];
  earlierEntries: HistoryEntry[];
  deleteEntry: (id: string) => void;
  clearAll: () => void;
}

export const useHistory = (): UseHistoryReturn => {
  const entries = useHistoryStore((s) => s.entries);
  const runCleanup = useHistoryStore((s) => s.runCleanup);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);
  const clearAll = useHistoryStore((s) => s.clearAll);
  const retentionDays = useSettingsStore((s) => s.retentionDays);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Run cleanup when app comes to foreground
  // and on a daily timer while app is active
  useEffect(() => {
    const retentionMs = retentionDays * MS_PER_DAY;

    // Initial cleanup on mount
    runCleanup(retentionMs);

    // Daily cleanup timer
    cleanupTimerRef.current = setInterval(
      () => runCleanup(retentionMs),
      MS_PER_DAY,
    );

    // Cleanup on app state change
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus): void => {
        if (appStateRef.current !== 'active' && nextState === 'active') {
          runCleanup(retentionMs);
        }
        appStateRef.current = nextState;
      },
    );

    return (): void => {
      if (cleanupTimerRef.current !== null) {
        clearInterval(cleanupTimerRef.current);
      }
      subscription.remove();
    };
  }, [retentionDays, runCleanup]);

  // Sort entries newest first
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

  // Section by calendar day
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterdayStart = todayStart - MS_PER_DAY;

  const todayEntries = sorted.filter((e) => e.timestamp >= todayStart);
  const yesterdayEntries = sorted.filter(
    (e) => e.timestamp >= yesterdayStart && e.timestamp < todayStart,
  );
  const earlierEntries = sorted.filter((e) => e.timestamp < yesterdayStart);

  return {
    entries: sorted,
    todayEntries,
    yesterdayEntries,
    earlierEntries,
    deleteEntry,
    clearAll,
  };
};
