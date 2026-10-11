// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { observable, syncState } from "@legendapp/state";
import type { ObservableParam } from "@legendapp/state";
import { useValue } from "@legendapp/state/react";
import { synced } from "@legendapp/state/sync";

import {
  registerUserScopedQuery,
  resetUserScopedQueries,
} from "@/hooks/core/useSyncedQuery";
import { createSyncedQuery } from "@/hooks/core/useSyncedQuery";

function makeObs(name: string) {
  return observable(
    synced({
      get: async () => ({ price: 10 }),
      persist: { name },
    }),
  ) as unknown as ObservableParam<unknown>;
}

async function populate(obs: ObservableParam<unknown>): Promise<void> {
  await act(async () => {
    await syncState(obs).sync();
  });
}

describe("resetUserScopedQueries", () => {
  it("clears a registered query so the previous value is no longer readable", async () => {
    const obs = makeObs("reset-a");
    registerUserScopedQuery(() => {
      obs.set(undefined);
      return Promise.resolve();
    });

    const { result } = renderHook(() => useValue(obs));

    await populate(obs);
    expect(result.current).toEqual({ price: 10 });

    await act(async () => {
      await resetUserScopedQueries();
    });

    expect(result.current).toBeUndefined();
  });

  it("clears a createSyncedQuery cache", async () => {
    const fetchFn = vi.fn(async () => ({ n: 7 }));
    const query = createSyncedQuery("reset-create-table", fetchFn);

    const { result } = renderHook(() => query.useQuery());

    await vi.waitFor(() => expect(result.current.data).toEqual({ n: 7 }));

    await act(async () => {
      await resetUserScopedQueries();
    });

    expect(result.current.data).toBeUndefined();
  });

  it("resolves even when a registered resetter rejects", async () => {
    const ran: string[] = [];

    registerUserScopedQuery(() => {
      ran.push("ok");
      return Promise.resolve();
    });
    registerUserScopedQuery(() => {
      ran.push("throwing");
      return Promise.reject(new Error("boom"));
    });

    await expect(resetUserScopedQueries()).resolves.toBeUndefined();
    expect(ran).toEqual(["ok", "throwing"]);
  });
});
