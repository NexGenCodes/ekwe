import { renderHook } from "@testing-library/react-native";

import { getEntryType } from "../useHistorySearch";
import { useHistoryListData } from "../useHistoryListData";

import type { HistoryEntry } from "@/store";

jest.mock("@/store", () => ({
  auth$: {
    user: { get: () => null },
  },
}));

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: overrides.id ?? "e1",
    sourceLang: "en",
    targetLang: "es",
    transcript: "hello",
    translation: overrides.type === "translation" ? "hola" : null,
    timestamp: 1_700_000_000_000,
    duration: 0,
    sourceApp: "shared-text",
    type: overrides.type,
    ...overrides,
  };
}

describe("getEntryType", () => {
  it("respects an explicit persisted type", () => {
    expect(getEntryType(entry({ type: "transcription" }))).toBe("transcription");
    expect(getEntryType(entry({ type: "translation" }))).toBe("translation");
  });

  it("derives transcription when translation is absent or identical to transcript", () => {
    const legacy = entry({ type: undefined, translation: null });
    const identical = entry({
      type: undefined,
      translation: "hello",
      transcript: "hello",
    });
    expect(getEntryType(legacy)).toBe("transcription");
    expect(getEntryType(identical)).toBe("transcription");
  });

  it("derives translation when a distinct translation exists", () => {
    const legacy = entry({
      type: undefined,
      translation: "  hola  ",
      transcript: "hello",
    });
    expect(getEntryType(legacy)).toBe("translation");
  });
});

describe("useHistoryListData", () => {
  it("returns empty list for an empty grouped view", async () => {
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        todayEntries: [],
        yesterdayEntries: [],
        thisWeekEntries: [],
        earlierEntries: [],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([]);
  });

  it("interleaves date headers before each non-empty bucket", async () => {
    const today = entry({ id: "t1" });
    const earlier = entry({ id: "e1", type: "translation" });
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        todayEntries: [today],
        yesterdayEntries: [],
        thisWeekEntries: [],
        earlierEntries: [earlier],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([
      { type: "header", title: "Today", count: 1 },
      { type: "entry", entry: today },
      { type: "header", title: "Earlier", count: 1 },
      { type: "entry", entry: earlier },
    ]);
  });

  it("skips buckets with no entries", async () => {
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        todayEntries: [],
        yesterdayEntries: [],
        thisWeekEntries: [],
        earlierEntries: [],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([]);
  });

  it("returns flat entries (no headers) when not grouped", async () => {
    const filtered = [entry({ id: "a" }), entry({ id: "b" })];
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: false,
        todayEntries: [entry({ id: "ignored" })],
        yesterdayEntries: [],
        thisWeekEntries: [],
        earlierEntries: [],
        filteredEntries: filtered,
      }),
    );
    expect(result.current).toEqual([
      { type: "entry", entry: filtered[0] },
      { type: "entry", entry: filtered[1] },
    ]);
  });
});
