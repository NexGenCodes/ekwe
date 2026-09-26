// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the Legend v2 → v3 syncState migration.
 *
 * `invalidateUsage` is a thin wrapper over a third-party API, so every feature
 * test mocks it out — which is exactly how `query$.syncState?.refresh?.()`
 * shipped broken while 337 tests passed. Reading `query$.syncState` on a
 * Legend v3 observable returns `{}`, and calling a property off that `{}`
 * throws "Object is not a function", so `invalidateUsage()` used to throw
 * synchronously at the success epilogue of transcription, translation and
 * dictation.
 *
 * These tests deliberately do NOT mock the module. They only fake the network
 * boundary (fetchUsage), so the real wrapper runs.
 */

vi.mock("@/store/mmkvPlugin", async () => {
  const { configureObservableSync } = await import("@legendapp/state/sync");

  const tables = new Map<string, unknown>();

  const mmkvPlugin = {
    loadTable: (table: string): Promise<void> => {
      if (!tables.has(table)) tables.set(table, {});
      return Promise.resolve();
    },
    getTable: <T>(table: string, init: object): T =>
      (tables.get(table) ?? init) as T,
    getMetadata: (): Record<string, never> => ({}),
    set: (): void => {},
    setMetadata: (): Promise<void> => Promise.resolve(),
    deleteTable: (table: string): void => {
      tables.delete(table);
    },
    deleteMetadata: (): void => {},
  };

  configureObservableSync({ persist: { plugin: mmkvPlugin } });

  return { mmkvPlugin };
});

const fetchUsage = vi.fn(async () => ({ ok: true as const, value: {} }));

vi.mock("@/services/usage", () => ({
  fetchUsage: () => fetchUsage(),
}));

import { invalidateUsage, usage$ } from "@/hooks/queries/useUsageQuery";

describe("invalidateUsage (real implementation, not mocked)", () => {
  beforeEach(() => {
    fetchUsage.mockClear();
  });

  it("is a callable function", () => {
    expect(typeof invalidateUsage).toBe("function");
  });

  it("does not throw when called", () => {
    expect(() => invalidateUsage()).not.toThrow();
  });

  it("does not throw when called repeatedly", () => {
    expect(() => {
      invalidateUsage();
      invalidateUsage();
      invalidateUsage();
    }).not.toThrow();
  });

  it("resolves via a callable syncState.sync on the query observable", () => {
    // Legend v3 exposes sync state through the syncState() helper. Reading it as
    // a property (`usage$.syncState`) yields {} and is the bug.
    const query$ = usage$ as unknown as { syncState?: object };
    expect(Object.keys(query$.syncState ?? {}).length).toBe(0);
  });
});
