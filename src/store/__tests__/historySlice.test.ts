import {
  createHistorySlice,
  HistoryEntry,
  HistoryState,
  HistoryActions,
} from '../historySlice';

describe('History Slice', () => {
  let slice: HistoryState & HistoryActions;
  const set = jest.fn((fn) => {
    const newState = fn(slice);
    slice = { ...slice, ...newState };
  });

  const mockEntry: HistoryEntry = {
    id: '1',
    sourceLang: 'en',
    targetLang: 'es',
    transcript: 'Hello',
    translation: 'Hola',
    timestamp: Date.now(),
    duration: 5,
    sourceApp: 'WhatsApp',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    slice = createHistorySlice(set);
  });

  it('should initialize with an empty history', () => {
    expect(slice.entries).toEqual([]);
  });

  it('should add a new entry to the top', () => {
    const entry2 = { ...mockEntry, id: '2' };
    slice.addEntry(mockEntry);
    slice.addEntry(entry2);
    expect(slice.entries[0]).toEqual(entry2);
    expect(slice.entries[1]).toEqual(mockEntry);
  });

  it('should delete an entry by id', () => {
    slice.addEntry(mockEntry);
    slice.deleteEntry('1');
    expect(slice.entries).toEqual([]);
  });

  it('should clear all entries', () => {
    slice.addEntry(mockEntry);
    slice.clearAll();
    expect(slice.entries).toEqual([]);
  });

  it('should run cleanup based on retention time', () => {
    jest.useFakeTimers();
    const now = Date.now();
    const oldEntry = { ...mockEntry, id: 'old', timestamp: now - 2000 };
    const nearEntry = { ...mockEntry, id: 'near', timestamp: now - 500 };

    slice.addEntry(oldEntry);
    slice.addEntry(nearEntry);

    slice.runCleanup(1000); // 1-second retention

    expect(slice.entries.length).toBe(1);
    expect(slice.entries[0].id).toBe('near');
    jest.useRealTimers();
  });
});
