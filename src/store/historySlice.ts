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

export const createHistorySlice = (
  set: (fn: (state: HistoryState) => Partial<HistoryState>) => void,
): HistoryState & HistoryActions => ({
  entries: [],
  addEntry: (entry): void =>
    set((state) => ({ entries: [entry, ...state.entries] })),
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
