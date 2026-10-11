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
    searchHistoryAsync: vi.fn(() => Promise.resolve([])),
  },
}));

import { Db } from "@/services/db";

const mockSearchHistory = Db.searchHistoryAsync as Mock;

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    captureId: "cap-1",
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "es",
    transcript: "hello world",
    translation: null,
    transliteration: null,
    timestamp: 1_700_000_000_000,
    duration: 4,
    sourceApp: "com.whatsapp",
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: null,
    type: "transcription",
    ...overrides,
  };
}

/** A DB row as `Db.searchHistoryAsync` resolves it. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "found",
    userId: "user-1",
    captureId: "cap-9",
    origin: "echo",
    input: "audio",
    source_lang: "en",
    target_lang: "es",
    transcript: "hello world",
    translation_text: "hola mundo",
    transliteration_text: null,
    duration: 4,
    source_app: "com.whatsapp",
    voice_id: null,
    stt_provider: "deepgram",
    mt_provider: "gemini",
    created_at: "2026-08-12T00:00:00Z",
    entry_type: "translation",
    ...overrides,
  };
}

describe("useHistorySearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchHistory.mockReset();
    mockSearchHistory.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no filter, empty query, and all entries", async () => {
    const entries = [
      entry({ id: "a" }),
      entry({ id: "b", origin: "speech-studio" }),
    ];
    const { result } = await renderHook(() => useHistorySearch(entries));

    expect(result.current.query).toBe("");
    expect(result.current.filter).toBe("all");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.filteredEntries).toEqual(entries);
  });

  it("filters by capture surface", async () => {
    const entries = [
      entry({ id: "a", origin: "echo" }),
      entry({ id: "b", origin: "speech-studio", sourceApp: null }),
      entry({ id: "c", origin: "orb" }),
    ];
    const { result } = await renderHook(() => useHistorySearch(entries));

    await act(() => result.current.setFilter("speech-studio"));
    expect(result.current.filteredEntries.map((e) => e.id)).toEqual(["b"]);

    await act(() => result.current.setFilter("orb"));
    expect(result.current.filteredEntries.map((e) => e.id)).toEqual(["c"]);

    await act(() => result.current.setFilter("echo"));
    expect(result.current.filteredEntries.map((e) => e.id)).toEqual(["a"]);
  });

  it("files an unrecognised origin under echo, ignoring the old sentinel", async () => {
    // `source_app` sentinels no longer derive anything: the column is
    // NOT NULL DEFAULT 'echo', so a sentinel is the only thing it can hold.
    const legacy = entry({
      id: "legacy",
      origin: "echo",
      sourceApp: "ekwe-home",
    });
    const { result } = await renderHook(() => useHistorySearch([legacy]));

    await act(() => result.current.setFilter("speech-studio"));
    expect(result.current.filteredEntries).toEqual([]);
  });

  it("debounces the query and delegates to the DB search", async () => {
    mockSearchHistory.mockResolvedValue([row()]);

    const { result } = await renderHook(() => useHistorySearch([]));

    await act(() => result.current.setQuery("hola"));

    expect(result.current.debouncedQuery).toBe("");
    expect(mockSearchHistory).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    expect(mockSearchHistory).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(true);
    expect(result.current.filteredEntries).toEqual([]);
  });

  it("applies the origin filter to search results too", async () => {
    mockSearchHistory.mockResolvedValue([row({ origin: "echo" })]);

    const { result } = await renderHook(() => useHistorySearch([]));

    await act(() => result.current.setQuery("hello"));
    await act(() => result.current.setFilter("orb"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    expect(result.current.filteredEntries).toEqual([]);
  });
});
