import { beforeEach, describe, expect, test, vi } from "vitest";

const mmkvMock = vi.hoisted(() => ({
  getString: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/services/mmkv", () => ({
  initializeMMKV: vi.fn(async () => {}),
  mmkv: mmkvMock,
}));

import {
  ObservablePersistMMKV,
  registerTableTransform,
} from "@/store/mmkvPlugin";

const config = {} as never;

beforeEach(() => {
  mmkvMock.getString.mockReset();
  mmkvMock.set.mockReset();
  mmkvMock.remove.mockReset();
});

describe("ObservablePersistMMKV table transforms", () => {
  test("applies a registered transform when loading a table", async () => {
    registerTableTransform("t1", (data) => ({ ...data, migrated: true }));
    mmkvMock.getString.mockReturnValue(JSON.stringify({ a: 1 }));

    const plugin = new ObservablePersistMMKV();
    await plugin.loadTable("t1", config);

    expect(plugin.getTable("t1", {}, config)).toMatchObject({
      a: 1,
      migrated: true,
    });
  });

  test("persists the migrated shape so the change survives a restart", async () => {
    registerTableTransform("t2", (data) => ({ ...data, migrated: true }));
    mmkvMock.getString.mockReturnValue(JSON.stringify({ a: 1 }));

    const plugin = new ObservablePersistMMKV();
    await plugin.loadTable("t2", config);

    expect(mmkvMock.set).toHaveBeenCalledWith(
      "t2",
      JSON.stringify({ a: 1, migrated: true }),
    );
  });

  test("does not write when there is no stored value to migrate", async () => {
    registerTableTransform("t3", (data) => ({ ...data, migrated: true }));
    mmkvMock.getString.mockReturnValue(null);

    const plugin = new ObservablePersistMMKV();
    await plugin.loadTable("t3", config);

    expect(mmkvMock.set).not.toHaveBeenCalled();
  });

  test("a later save keeps the migrated value", async () => {
    // The race this replaces: a migration writing the same key from outside the
    // plugin could be overwritten by the next save() from a pre-migration
    // snapshot. With the transform inside loadTable, the snapshot is already
    // migrated, so save() cannot regress it.
    registerTableTransform("t4", (data) => ({ ...data, migrated: true }));
    mmkvMock.getString.mockReturnValue(JSON.stringify({ a: 1 }));

    const plugin = new ObservablePersistMMKV();
    await plugin.loadTable("t4", config);
    plugin.set(
      "t4",
      [{ path: ["a"], valueAtPath: 1, pathTypes: [], prevAtPath: undefined }],
      config,
    );

    const stored = JSON.parse(mmkvMock.set.mock.calls.at(-1)![1] as string);
    expect(stored.migrated).toBe(true);
  });
});
