import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useHistory } from 'src/hooks/useHistory';
import { useHistoryStore, useSettingsStore } from 'src/store';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('useHistory', () => {
  const now = new Date().getTime();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useHistoryStore.setState({
      entries: [
        {
          id: 'today-1',
          transcript: 'Today',
          translation: null,
          sourceApp: null,
          timestamp: now,
          duration: 1,
          sourceLang: 'en',
          targetLang: 'es',
        },
        {
          id: 'yesterday-1',
          transcript: 'Yesterday',
          translation: null,
          sourceApp: null,
          timestamp: now - MS_PER_DAY,
          duration: 1,
          sourceLang: 'en',
          targetLang: 'es',
        },
        {
          id: 'earlier-1',
          transcript: 'Earlier',
          translation: null,
          sourceApp: null,
          timestamp: now - 2 * MS_PER_DAY,
          duration: 1,
          sourceLang: 'en',
          targetLang: 'es',
        },
      ],
      runCleanup: jest.fn(),
      deleteEntry: jest.fn(),
      clearAll: jest.fn(),
    });
    useSettingsStore.setState({
      retentionDays: 7,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('entries are sorted newest first', () => {
    const { result } = renderHook(() => useHistory());
    expect(result.current.entries[0].id).toBe('today-1');
    expect(result.current.entries[1].id).toBe('yesterday-1');
    expect(result.current.entries[2].id).toBe('earlier-1');
  });

  it('sectioning by date works correctly', () => {
    const { result } = renderHook(() => useHistory());
    expect(result.current.todayEntries).toHaveLength(1);
    expect(result.current.yesterdayEntries).toHaveLength(1);
    expect(result.current.earlierEntries).toHaveLength(1);
    expect(result.current.todayEntries[0].id).toBe('today-1');
  });

  it('runCleanup called on mount and on interval', () => {
    const runCleanup = jest.fn();
    useHistoryStore.setState({ runCleanup });

    renderHook(() => useHistory());

    expect(runCleanup).toHaveBeenCalledWith(7 * MS_PER_DAY);

    act(() => {
      jest.advanceTimersByTime(MS_PER_DAY);
    });
    expect(runCleanup).toHaveBeenCalledTimes(2);
  });

  it('runCleanup called when app comes to foreground', () => {
    const runCleanup = jest.fn();
    useHistoryStore.setState({ runCleanup });

    renderHook(() => useHistory());

    act(() => {
      // Simulate app state change
      const callback = (AppState.addEventListener as jest.Mock).mock
        .calls[0][1];
      callback('background');
      callback('active');
    });

    expect(runCleanup).toHaveBeenCalledTimes(2);
  });

  it('deleteEntry calls store deleteEntry', () => {
    const deleteEntry = jest.fn();
    useHistoryStore.setState({ deleteEntry });

    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.deleteEntry('test-id');
    });

    expect(deleteEntry).toHaveBeenCalledWith('test-id');
  });

  it('clearAll calls store clearAll', () => {
    const clearAll = jest.fn();
    useHistoryStore.setState({ clearAll });

    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.clearAll();
    });

    expect(clearAll).toHaveBeenCalled();
  });
});
