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
  updateEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  deleteEntry: (id: string) => void;
  clearAll: () => void;
  runCleanup: (retentionMs: number) => void;
}

export const createHistorySlice = (
  set: (fn: (state: HistoryState) => Partial<HistoryState>) => void,
): HistoryState & HistoryActions => ({
  entries: [],
  addEntry: (entry): void =>
    set((state) => ({ entries: [entry, ...state.entries] })),
  updateEntry: (id, updates): void =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, ...updates } : e,
      ),
    })),
  deleteEntry: (id): void =>
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    })),
  clearAll: (): void => set(() => ({ entries: [] })),
  runCleanup: (retentionMs): void =>
    set((state) => ({
      entries: state.entries.filter(
        (e) => Date.now() - e.timestamp <= retentionMs,
      ),
    })),
});
