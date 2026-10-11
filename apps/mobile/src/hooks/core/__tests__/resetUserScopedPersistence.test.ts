// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { observable, syncState } from "@legendapp/state";
import type { ObservableParam } from "@legendapp/state";
import { useValue } from "@legendapp/state/react";
import { synced } from "@legendapp/state/sync";

import { mmkv } from "@/services/mmkv";
import { mmkvPlugin } from "@/store/mmkvPlugin";

const TABLE = "persist-check-table";

describe("user-scoped query persistence", () => {
  it("clears the persisted row as well as the observable value", async () => {
    const obs = observable(
      synced({
        get: async () => ({ secret: "previous-user-data" }),
        persist: { name: TABLE, plugin: mmkvPlugin },
      }),
    ) as unknown as ObservableParam<unknown>;

    const { result } = renderHook(() => useValue(obs));

    await act(async () => {
      await syncState(obs).sync();
    });

    expect(result.current).toEqual({ secret: "previous-user-data" });

    await act(async () => {
      obs.set(undefined);
    });

    expect(result.current).toBeUndefined();
    expect(obs.peek()).toBeUndefined();
    expect(mmkv.getAllKeys()).not.toContain(TABLE);
  });
});
