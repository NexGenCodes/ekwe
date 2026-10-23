// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHistoryQuery } from "@/hooks/queries/useHistoryQuery";

const getHistoryPage = vi.fn();

vi.mock("@/services/db", () => ({
  Db: {
    getHistoryPage: (...args: unknown[]) => getHistoryPage(...args),
  },
}));

vi.mock("@/store", () => ({
  history$: new Proxy(
    {},
    {
      get: () => ({ peek: () => undefined, set: () => {} }),
    },
  ),
  sortedHistory$: { peek: () => [] },
}));

vi.mock("@/utils/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function localRow(id: string, timestamp: number) {
  return {
    id,
    userId: "user-a",
    createdAt: new Date(timestamp).toISOString(),
    captureId: null,
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "fr",
    transcript: "hello",
    translationText: "bonjour",
    transliterationText: null,
    duration: 1,
    sourceApp: "",
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: "gemini",
    entryType: "translation",
    revision: 0,
    deletedAt: null,
  };
}

describe("useHistoryQuery", () => {
  beforeEach(() => {
    getHistoryPage.mockReset();
    getHistoryPage.mockReturnValue([]);
  });

  it("loads once per user and again when the account changes", async () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | undefined }) => useHistoryQuery(userId),
      { initialProps: { userId: "user-a" as string | undefined } },
    );

    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    // Re-rendering with the same user must not re-trigger a fetch.
    rerender({ userId: "user-a" });
    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledTimes(1);
    });

    // Signing in as a different account has to load that account's history.
    getHistoryPage.mockClear();
    rerender({ userId: "user-b" });
    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledTimes(1);
    });
    expect(getHistoryPage).toHaveBeenCalledWith("user-b", 20, null);
  });

  it("does not fetch while signed out and recovers on sign-in", async () => {
    const { rerender } = renderHook(
      ({ userId }: { userId: string | undefined }) => useHistoryQuery(userId),
      { initialProps: { userId: undefined as string | undefined } },
    );

    await act(async () => {});
    expect(getHistoryPage).not.toHaveBeenCalled();

    rerender({ userId: "user-c" });
    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledWith("user-c", 20, null);
    });
  });

  it("clears the initial loading flag after the first page resolves", async () => {
    const { result } = renderHook(() => useHistoryQuery("user-d"));

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });
    expect(getHistoryPage).toHaveBeenCalledWith("user-d", 20, null);
  });

  it("keeps paging while a full page comes back", async () => {
    getHistoryPage.mockReturnValue(
      Array.from({ length: 20 }, (_, i) =>
        localRow(`row-${i}`, Date.now() - i * 1000),
      ),
    );

    const { result } = renderHook(() => useHistoryQuery("user-a"));
    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(getHistoryPage).toHaveBeenCalledTimes(2);
    expect(getHistoryPage).toHaveBeenLastCalledWith(
      "user-a",
      20,
      expect.objectContaining({ id: "row-19" }),
    );
    expect(result.current.hasMore).toBe(true);
  });

  it("stops paging on a partial page", async () => {
    getHistoryPage.mockReturnValue([
      localRow("row-1", Date.now()),
      localRow("row-2", Date.now() - 1000),
    ]);

    const { result } = renderHook(() => useHistoryQuery("user-a"));
    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.hasMore).toBe(false);
  });
});
