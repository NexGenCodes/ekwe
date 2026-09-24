// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useHistorySearch } from "@/hooks/useHistorySearch";

import type { HistoryEntry } from "@/store";

vi.mock("@/store", () => ({
  auth$: {
    user: { get: () => ({ id: "user-1" }) },
  },
}));

vi.mock("@/services/db", () => ({
  Db: {
    searchHistory: vi.fn(() => []),
  },
}));

import { Db } from "@/services/db";

const mockSearchHistory = Db.searchHistory as Mock;

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: overrides.id ?? "e1",
    sourceLang: "en",
    targetLang: "es",
    transcript: "hello world",
    translation: null,
    timestamp: 1_700_000_000_000,
    duration: 0,
    sourceApp: "shared-text",
    type: "transcription",
    ...overrides,
  };
}

describe("useHistorySearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchHistory.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no filter, empty query, and all entries", async () => {
    const entries = [
      entry({ id: "a" }),
      entry({ id: "b", type: "translation" }),
    ];
    const { result } = await renderHook(() => useHistorySearch(entries));

    expect(result.current.query).toBe("");
    expect(result.current.filter).toBe("all");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.filteredEntries).toEqual(entries);
  });

  it("filters to transcriptions by type", async () => {
    const entries = [
      entry({ id: "a", type: "transcription" }),
      entry({ id: "b", type: "translation" }),
    ];
    const { result } = await renderHook(() => useHistorySearch(entries));

    await act(() => result.current.setFilter("transcription"));
    expect(result.current.filteredEntries).toEqual([entries[0]]);
  });

  it("filters to translations by type", async () => {
    const entries = [
      entry({ id: "a", type: "transcription" }),
      entry({ id: "b", type: "translation" }),
    ];
    const { result } = await renderHook(() => useHistorySearch(entries));

    await act(() => result.current.setFilter("translation"));
    expect(result.current.filteredEntries).toEqual([entries[1]]);
  });

  it("debounces the query and delegates to the DB search", async () => {
    const searchResult = {
      id: "found",
      source_lang: "en",
      target_lang: "es",
      transcript: "hello world",
      translation_text: "hola mundo",
      transliteration_text: null,
      duration: 0,
      source_app: "shared-text",
      provider: "gemini",
      created_at: "2026-08-12T00:00:00Z",
      entry_type: "translation",
    };
    mockSearchHistory.mockReturnValue([searchResult]);

    const { result } = await renderHook(() => useHistorySearch([]));

    await act(() => result.current.setQuery("hola"));

    expect(result.current.debouncedQuery).toBe("");
    expect(mockSearchHistory).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTime(301));

    expect(result.current.debouncedQuery).toBe("hola");
    expect(result.current.isSearching).toBe(true);
    expect(mockSearchHistory).toHaveBeenCalledWith("user-1", "hola", 200);
    expect(result.current.filteredEntries).toMatchObject([
      { id: "found", transcript: "hello world" },
    ]);
  });

  it("does not search the DB without an authenticated user", async () => {
    (
      await vi.importMock<{ auth$: { user: { get: unknown } } }>("@/store")
    ).auth$.user.get = () => null;

    const { result } = await renderHook(() => useHistorySearch([]));

    await act(() => result.current.setQuery("hola"));
    await act(() => vi.advanceTimersByTime(301));

    expect(mockSearchHistory).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(true);
    expect(result.current.filteredEntries).toEqual([]);
  });

  it("applies the type filter to search results too", async () => {
    mockSearchHistory.mockReturnValue([
      {
        id: "found",
        source_lang: "en",
        target_lang: "es",
        transcript: "hello world",
        translation_text: null,
        transliteration_text: null,
        duration: 0,
        source_app: "shared-text",
        provider: "gemini",
        created_at: "2026-08-12T00:00:00Z",
        entry_type: "transcription",
      },
    ]);

    const { result } = await renderHook(() => useHistorySearch([]));

    await act(() => result.current.setQuery("hello"));
    await act(() => result.current.setFilter("translation"));
    await act(() => vi.advanceTimersByTime(301));

    expect(result.current.filteredEntries).toEqual([]);
  });
});
