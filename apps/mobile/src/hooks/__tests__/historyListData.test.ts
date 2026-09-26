// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { hasTranslation } from "@/hooks/useHistorySearch";
import { useHistoryListData } from "@/hooks/useHistoryListData";

import type { HistoryEntry } from "@/store";

vi.mock("@/store", () => ({
  auth$: {
    user: { get: () => null },
  },
}));

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    captureId: "cap-1",
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "es",
    transcript: "hello",
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

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("hasTranslation", () => {
  it("is false when no translation was produced", () => {
    expect(hasTranslation(entry({ translation: null }))).toBe(false);
  });

  it("is false when the translation is identical to the transcript", () => {
    expect(
      hasTranslation(entry({ translation: "hello", transcript: "hello" })),
    ).toBe(false);
  });

  it("is false when the translation is only whitespace around the transcript", () => {
    expect(
      hasTranslation(entry({ translation: "  hello  ", transcript: "hello" })),
    ).toBe(false);
  });

  it("is true when a distinct translation exists", () => {
    expect(
      hasTranslation(entry({ translation: "  hola  ", transcript: "hello" })),
    ).toBe(true);
  });
});

describe("useHistoryListData", () => {
  it("returns empty list for an empty grouped view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        entries: [],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([]);
  });

  it("labels today, yesterday, and recent dates with day headers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const todayEntry = entry({ id: "t1", timestamp: NOW });
    const yesterdayEntry = entry({ id: "y1", timestamp: NOW - DAY });
    const threeDaysAgo = entry({ id: "d1", timestamp: NOW - 3 * DAY });
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        entries: [todayEntry, yesterdayEntry, threeDaysAgo],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([
      { type: "header", title: "Today", count: 1 },
      { type: "entry", entry: todayEntry },
      { type: "header", title: "Yesterday", count: 1 },
      { type: "entry", entry: yesterdayEntry },
      { type: "header", title: "Sat, Sep 12", count: 1 },
      { type: "entry", entry: threeDaysAgo },
    ]);
  });

  it("collapses entries older than ~6 months into month headers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oldJan = entry({ id: "j1", timestamp: Date.UTC(2026, 0, 10, 9, 0) });
    const olderJan = entry({
      id: "j2",
      timestamp: Date.UTC(2026, 0, 4, 18, 0),
    });
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        entries: [oldJan, olderJan],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([
      { type: "header", title: "January 2026", count: 2 },
      { type: "entry", entry: oldJan },
      { type: "entry", entry: olderJan },
    ]);
  });

  it("emits a separate header only when the day changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const first = entry({ id: "a", timestamp: NOW });
    const second = entry({ id: "b", timestamp: NOW - 2 * 60 * 60 * 1000 });
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: true,
        entries: [first, second],
        filteredEntries: [],
      }),
    );
    expect(result.current).toEqual([
      { type: "header", title: "Today", count: 2 },
      { type: "entry", entry: first },
      { type: "entry", entry: second },
    ]);
  });

  it("returns flat entries (no headers) when not grouped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const filtered = [entry({ id: "a" }), entry({ id: "b" })];
    const { result } = await renderHook(() =>
      useHistoryListData({
        isGrouped: false,
        entries: [entry({ id: "ignored" })],
        filteredEntries: filtered,
      }),
    );
    expect(result.current).toEqual([
      { type: "entry", entry: filtered[0] },
      { type: "entry", entry: filtered[1] },
    ]);
  });
});
