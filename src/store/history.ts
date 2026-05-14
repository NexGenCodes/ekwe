import { observable } from '@legendapp/state';
import { persistObservable } from '@legendapp/state/persist';

import { ObservablePersistMMKVCustom } from '@/store/mmkvPlugin';

export interface HistoryEntry {
  id: string;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  timestamp: number;
  duration: number;
  sourceApp: string | null;
  provider?: string;
}

export interface HistoryState {
  entries: HistoryEntry[];
}

export const history$ = observable<HistoryState>({
  entries: [],
});

// Persist history to MMKV (uses global plugin configured in store/index.ts)
persistObservable(history$, {
  local: 'ekwe-history',
  pluginLocal: ObservablePersistMMKVCustom,
});

// Actions
export const historyActions = {
  addEntry: (entry: HistoryEntry): void => {
    history$.entries.unshift(entry);
  },
  updateEntry: (id: string, updates: Partial<HistoryEntry>): void => {
    const entries = history$.entries.get();
    const index = entries.findIndex((e) => e.id === id);
    if (index !== -1) {
      history$.entries[index].assign(updates);
    }
  },
  deleteEntry: (id: string): void => {
    const entries = history$.entries.get();
    history$.entries.set(entries.filter((e) => e.id !== id));
  },
  clearAll: (): void => {
    history$.entries.set([]);
  },
  runCleanup: (retentionMs: number): void => {
    const now = Date.now();
    const entries = history$.entries.get();
    history$.entries.set(
      entries.filter((e) => now - e.timestamp <= retentionMs),
    );
  },
};
