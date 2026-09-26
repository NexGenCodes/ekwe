// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/mmkvPlugin", async () => {
  const { configureObservableSync } = await import("@legendapp/state/sync");

  const mmkvPlugin = {
    loadTable: (): Promise<void> => Promise.resolve(),
    getTable: <T>(_table: string, init: object): T => init as T,
    getMetadata: (): Record<string, never> => ({}),
    set: (): void => {},
    setMetadata: (): Promise<void> => Promise.resolve(),
    deleteTable: (): void => {},
    deleteMetadata: (): void => {},
  };

  configureObservableSync({ persist: { plugin: mmkvPlugin } });

  return { mmkvPlugin };
});

import { observable, syncState } from "@legendapp/state";
import type { ObservableParam } from "@legendapp/state";
import { synced } from "@legendapp/state/sync";

import { createSyncedQuery } from "@/hooks/core/useSyncedQuery";

describe("createSyncedQuery", () => {
  it("reads sync state through the syncState() helper, not query$.syncState", () => {
    const query$ = observable(
      synced({
        get: async (): Promise<{ n: number }> => ({ n: 1 }),
        persist: { name: "probe-table" },
      }),
    ) as unknown as ObservableParam<unknown>;

    // Legend v3: query$.syncState is not a real property and reads back as {}.
    const legacyState = (query$ as unknown as { syncState?: object }).syncState;
    expect(Object.keys(legacyState ?? {}).length).toBe(0);

    const sync$ = syncState(query$);
    expect(typeof sync$.sync).toBe("function");
  });

  it("invalidate() triggers a refetch without throwing", async () => {
    const fetchFn = vi.fn(async (): Promise<{ n: number }> => ({ n: 1 }));
    const query = createSyncedQuery("invalidate-table", fetchFn);

    expect(() => query.invalidate()).not.toThrow();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
  });

  it("useQuery().refetch() triggers a refetch without throwing", async () => {
    const fetchFn = vi.fn(async (): Promise<{ n: number }> => ({ n: 1 }));
    const query = createSyncedQuery("refetch-table", fetchFn);

    const { result } = renderHook(() => query.useQuery());

    expect(() => result.current.refetch()).not.toThrow();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
  });
});
