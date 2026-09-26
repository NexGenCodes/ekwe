// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const cacheDeletes: string[] = [];

vi.mock("@/utils", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/platform", () => ({ isIOS: false, isAndroid: false }));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    name: string;
    constructor(uri: string) {
      this.uri = uri;
      this.name = uri.split("/").pop() ?? uri;
    }
    get exists(): boolean {
      return true;
    }
    delete(): void {
      cacheDeletes.push(this.uri);
    }
  },
  Directory: class {
    list(): unknown[] {
      return [];
    }
  },
  Paths: { cache: { uri: "file:///mock/cache/" } },
}));

import { useSessionAudioFiles } from "@/utils/sessionAudioFiles";

const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

beforeEach(() => {
  cacheDeletes.length = 0;
});

describe("useSessionAudioFiles", () => {
  it("deletes a file only after the delay, so the player can release it", async () => {
    const { result } = renderHook(() => useSessionAudioFiles());

    act(() => {
      result.current.remember("file:///mock/cache/note.ogg");
    });
    act(() => {
      result.current.deleteAfterDelay("file:///mock/cache/note.ogg");
    });

    // Nothing is removed synchronously.
    expect(cacheDeletes).toEqual([]);

    await settle();
    expect(cacheDeletes).toContain("file:///mock/cache/note.ogg");
  });

  it("purges every remembered file on unmount-path teardown", async () => {
    const { result } = renderHook(() => useSessionAudioFiles());

    act(() => {
      result.current.remember("file:///mock/cache/a.ogg");
      result.current.remember("file:///mock/cache/b.ogg");
    });
    act(() => {
      result.current.purge();
    });

    await settle();
    // Siblings (.caf/.wav) are expanded by cleanAudioArtifacts; what matters
    // here is that both remembered files were released.
    expect(cacheDeletes).toContain("file:///mock/cache/a.ogg");
    expect(cacheDeletes).toContain("file:///mock/cache/b.ogg");
  });

  it("does not re-delete a file that was already discarded", async () => {
    const { result } = renderHook(() => useSessionAudioFiles());

    act(() => {
      result.current.remember("file:///mock/cache/note.ogg");
    });
    act(() => {
      result.current.deleteAfterDelay("file:///mock/cache/note.ogg");
    });
    act(() => {
      result.current.purge();
    });

    await settle();
    // A file is released once, not once per bookkeeping call.
    expect(
      cacheDeletes.filter((uri) => uri === "file:///mock/cache/note.ogg"),
    ).toHaveLength(1);
  });

  it("ignores empty input", async () => {
    const { result } = renderHook(() => useSessionAudioFiles());

    act(() => {
      result.current.remember(null);
      result.current.remember(undefined);
      result.current.deleteAfterDelay(null);
      result.current.deleteAfterDelay(undefined);
      result.current.purge();
    });

    await settle();
    expect(cacheDeletes).toEqual([]);
  });
});
