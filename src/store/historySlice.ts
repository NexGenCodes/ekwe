import type { StateCreator } from 'zustand';

export interface HistoryEntry {
  id: string;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  timestamp: number;
  duration: number;
  sourceApp: string | null;
}

export interface HistoryState {
  entries: HistoryEntry[];
}

export interface HistoryActions {
  addEntry: (entry: HistoryEntry) => void;
  deleteEntry: (id: string) => void;
  clearAll: () => void;
  runCleanup: (retentionMs: number) => void;
}

export type HistorySlice = HistoryState & HistoryActions;

export const createHistorySlice: StateCreator<
  HistorySlice,
  [],
  [],
  HistorySlice
> = (set) => ({
  entries: [],
  addEntry: (entry: HistoryEntry): void => {
    set((state) => ({ entries: [entry, ...state.entries] }));
  },
  deleteEntry: (id: string): void => {
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    }));
  },
  clearAll: (): void => {
    set({ entries: [] });
  },
  runCleanup: (retentionMs: number): void => {
    const now = Date.now();
    set((state) => ({
      entries: state.entries.filter((e) => now - e.timestamp <= retentionMs),
    }));
  },
});
