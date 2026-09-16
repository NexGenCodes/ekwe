// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/services/db", () => ({
  Db: {
    getHistoryPage: vi.fn(),
  },
}));

vi.mock("@/services/SyncService", () => ({
  SyncService: {
    fetchOlderHistory: vi.fn(),
  },
}));

// Simple legendapp-style observable mock: history$[id] → { get(), set(v) }
const store: Record<string, unknown> = {};
function createObservable() {
  const self = Object.create(null);
  Object.defineProperty(self, Symbol.iterator, { value: undefined });
  return new Proxy(self, {
    get(_target, prop: string | symbol) {
      if (prop === "get") {
        return () => ({ ...store });
      }
      if (typeof prop === "string") {
        return {
          get: () => store[prop] ?? undefined,
          set: (val: unknown) => {
            store[prop] = val;
          },
        };
      }
      return undefined;
    },
  });
}

vi.mock("@/store", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    history$: createObservable(),
    auth$: {
      user: { get: () => ({ id: "test-user" }) },
      isPro: { get: () => false, peek: () => false },
    },
  };
});

import { Db } from "@/services/db";
import { SyncService } from "@/services/SyncService";
import { useHistoryQuery } from "@/hooks/queries/useHistoryQuery";

const getHistoryPage = vi.mocked(Db.getHistoryPage);
const fetchOlderHistory = vi.mocked(SyncService.fetchOlderHistory);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

// HistoryRow shape as produced by Db.getHistoryPage / rowToEntry expects
// createdAt + translationText (camelCase from drizzle inference).
function makeRow(id: string, ts: number, sourceLang = "en", targetLang = "es") {
  return {
    id,
    userId: "test-user",
    sourceLang,
    targetLang,
    transcript: `transcript-${id}`,
    translationText: `translation-${id}`,
    transliterationText: null,
    duration: 10,
    sourceApp: "ios",
    provider: "gemini",
    createdAt: new Date(ts).toISOString(),
    entryType: "translation" as const,
  };
}

describe("useHistoryQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("fetches the first page from local SQLite with cursor null and pages correctly", async () => {
    const now = Date.now();
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeRow(`row-${i}`, now - i * 1000),
    );
    getHistoryPage.mockReturnValue(entries);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHistoryQuery("test-user"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    expect(getHistoryPage).toHaveBeenCalledWith("test-user", 20, null);
    expect(fetchOlderHistory).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.loadMore();
    });

    expect(getHistoryPage).toHaveBeenCalledWith(
      "test-user",
      20,
      expect.objectContaining({
        created_at: expect.any(String),
        id: "row-19",
      }),
    );
  });

  it("switches to cloud tier when local window is exhausted", async () => {
    const now = Date.now();
    getHistoryPage
      .mockReturnValueOnce(
        Array.from({ length: 20 }, (_, i) =>
          makeRow(`local-${i}`, now - i * 1000),
        ),
      )
      .mockReturnValueOnce([]);

    fetchOlderHistory.mockResolvedValue([
      {
        id: "cloud-1",
        sourceLang: "en",
        targetLang: "es",
        transcript: "cloud-1",
        translation: "t-cloud-1",
        transliteration: null,
        duration: 10,
        sourceApp: "ios",
        provider: "gemini",
        timestamp: now - 20000,
        type: "translation" as const,
      },
      {
        id: "cloud-2",
        sourceLang: "en",
        targetLang: "es",
        transcript: "cloud-2",
        translation: "t-cloud-2",
        transliteration: null,
        duration: 10,
        sourceApp: "ios",
        provider: "gemini",
        timestamp: now - 21000,
        type: "translation" as const,
      },
    ]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHistoryQuery("test-user"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchOlderHistory).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({ id: "local-19" }),
      20,
    );
  });

  it("tops up a short local page from the cloud full and pages on", async () => {
    const now = Date.now();
    getHistoryPage.mockReturnValue(
      Array.from({ length: 5 }, (_, i) => makeRow(`only-${i}`, now - i * 1000)),
    );
    // Fill the partially-cached local page up to a full page so the cursor
    // can keep advancing into older cloud rows.
    fetchOlderHistory.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        id: `cloud-${i}`,
        sourceLang: "en",
        targetLang: "es",
        transcript: `cloud-${i}`,
        translation: `t-cloud-${i}`,
        transliteration: null,
        duration: 10,
        sourceApp: "ios",
        provider: "gemini",
        timestamp: now - 10000 - i * 1000,
        type: "translation" as const,
      })),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHistoryQuery("test-user"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    expect(fetchOlderHistory).toHaveBeenCalledWith(
      "test-user",
      expect.objectContaining({ id: "only-4" }),
      15,
    );
  });

  it("pages the newest cloud page when local SQLite is empty (cold start)", async () => {
    // Fresh install / 7-day window drained: no local rows to seed a cursor.
    getHistoryPage.mockReturnValue([]);

    fetchOlderHistory.mockResolvedValue([
      {
        id: "cloud-1",
        sourceLang: "en",
        targetLang: "es",
        transcript: "cloud-1",
        translation: "t-cloud-1",
        transliteration: null,
        duration: 10,
        sourceApp: "ios",
        provider: "gemini",
        timestamp: Date.now() - 20000,
        type: "translation" as const,
      },
      {
        id: "cloud-2",
        sourceLang: "en",
        targetLang: "es",
        transcript: "cloud-2",
        translation: "t-cloud-2",
        transliteration: null,
        duration: 10,
        sourceApp: "ios",
        provider: "gemini",
        timestamp: Date.now() - 21000,
        type: "translation" as const,
      },
    ]);

    const { wrapper } = createWrapper();
    renderHook(() => useHistoryQuery("test-user"), { wrapper });

    await waitFor(() => {
      expect(fetchOlderHistory).toHaveBeenCalledWith(
        "test-user",
        null, // null cursor ⇒ newest cloud page
        20,
      );
    });
  });

  it("reports hasMore false when local + cloud have no more rows", async () => {
    const now = Date.now();
    getHistoryPage.mockReturnValue(
      Array.from({ length: 5 }, (_, i) => makeRow(`only-${i}`, now - i * 1000)),
    );
    // No older cloud rows available: the short local page is truly the end.
    fetchOlderHistory.mockResolvedValue([]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHistoryQuery("test-user"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    expect(fetchOlderHistory).toHaveBeenCalled();
  });

  it("does not query when userId is undefined (signed out)", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHistoryQuery(undefined), {
      wrapper,
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.hasMore).toBe(false);
    expect(getHistoryPage).not.toHaveBeenCalled();
    expect(fetchOlderHistory).not.toHaveBeenCalled();
  });

  it("consecutive loadMore calls are deduped (no double fetch)", async () => {
    const now = Date.now();
    getHistoryPage.mockReturnValue(
      Array.from({ length: 20 }, (_, i) => makeRow(`row-${i}`, now - i * 1000)),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHistoryQuery("test-user"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await Promise.all([
        result.current.loadMore(),
        result.current.loadMore(),
        result.current.loadMore(),
      ]);
    });

    const page2Calls = getHistoryPage.mock.calls.filter(
      (call) => call[2] !== null,
    );
    expect(page2Calls.length).toBe(1);
  });
});
