// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHistoryQuery } from "@/hooks/queries/useHistoryQuery";

const getHistoryPage = vi.fn();
const fetchOlderHistory = vi.fn();

vi.mock("@/services/db", () => ({
  Db: {
    getHistoryPage: (...args: unknown[]) => getHistoryPage(...args),
  },
}));

vi.mock("@/services/syncService", () => ({
  SyncService: {
    fetchOlderHistory: (...args: unknown[]) => fetchOlderHistory(...args),
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

describe("useHistoryQuery", () => {
  beforeEach(() => {
    getHistoryPage.mockReset();
    fetchOlderHistory.mockReset();
    getHistoryPage.mockReturnValue([]);
    fetchOlderHistory.mockResolvedValue([]);
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

  it("reports initial loading until the first page resolves", async () => {
    let resolveFetch: (value: unknown[]) => void = () => {};
    fetchOlderHistory.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useHistoryQuery("user-d"));

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(true);
    });

    await act(async () => {
      resolveFetch([]);
    });

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });
  });
});
