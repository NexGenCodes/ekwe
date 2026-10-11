import { beforeEach, describe, expect, it, vi } from "vitest";
import { File } from "expo-file-system";
import { VOICE_PREVIEW_VERSION } from "@ekwe/shared";

const cacheDeletes: string[] = [];
const moves: { from: string; to: string; overwrite?: boolean }[] = [];
const mockDirEntries: unknown[] = [];
let dirListThrows = false;
/** Paths that "exist" on disk, with their reported size. */
const existingFiles = new Map<string, number>();

vi.mock("@/utils", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/platform", () => ({ isIOS: false, isAndroid: false }));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    name: string;
    size: number;
    constructor(uri: string) {
      this.uri = uri;
      this.name = uri.split("/").pop() ?? uri;
      this.size = existingFiles.get(uri) ?? 0;
    }
    get exists(): boolean {
      return existingFiles.has(this.uri);
    }
    async move(
      destination: { uri: string },
      options?: { overwrite?: boolean },
    ): Promise<void> {
      moves.push({
        from: this.uri,
        to: destination.uri,
        overwrite: options?.overwrite,
      });
      existingFiles.delete(this.uri);
      existingFiles.set(destination.uri, 1024);
    }
    delete(): void {
      cacheDeletes.push(this.uri);
      existingFiles.delete(this.uri);
    }
  },
  Directory: class {
    list(): unknown[] {
      if (dirListThrows) throw new Error("cache unavailable");
      return mockDirEntries;
    }
  },
  Paths: { cache: { uri: "file:///mock/cache/" } },
}));

import {
  clearStalePreviewCache,
  getCachedPreviewUri,
  persistPreview,
} from "@/utils/voicePreviewCache";

const memoName = (key: string, version = VOICE_PREVIEW_VERSION): string =>
  `ekwe_vpreview_v${version}_${key}.ogg`;

beforeEach(() => {
  cacheDeletes.length = 0;
  moves.length = 0;
  mockDirEntries.length = 0;
  dirListThrows = false;
  existingFiles.clear();
});

describe("getCachedPreviewUri", () => {
  it("returns null when the voice has never been previewed", () => {
    expect(getCachedPreviewUri("standard_female")).toBeNull();
  });

  it("finds a memoized clip regardless of container", () => {
    existingFiles.set(`file:///mock/cache/${memoName("studio_male")}`, 2048);
    expect(getCachedPreviewUri("studio_male")).toBe(
      `file:///mock/cache/${memoName("studio_male")}`,
    );
  });

  it("ignores a zero-length file, which is a failed write", () => {
    existingFiles.set(`file:///mock/cache/${memoName("standard_male")}`, 0);
    expect(getCachedPreviewUri("standard_male")).toBeNull();
  });

  it("does not match a memo written by a different version", () => {
    existingFiles.set(
      `file:///mock/cache/${memoName("standard_female", 0)}`,
      2048,
    );
    expect(getCachedPreviewUri("standard_female")).toBeNull();
  });
});

describe("persistPreview", () => {
  it("moves the clip to a deterministic, version-stamped path", async () => {
    existingFiles.set("file:///mock/cache/ekwe_speech_123.ogg", 2048);

    const result = await persistPreview(
      "file:///mock/cache/ekwe_speech_123.ogg",
      "studio_female",
    );

    expect(result).toBe(`file:///mock/cache/${memoName("studio_female")}`);
    expect(moves).toEqual([
      {
        from: "file:///mock/cache/ekwe_speech_123.ogg",
        to: `file:///mock/cache/${memoName("studio_female")}`,
        overwrite: true,
      },
    ]);
  });

  it("replaces the previous clip for the same voice", async () => {
    existingFiles.set("file:///mock/cache/ekwe_speech_9.ogg", 2048);
    const previous = `file:///mock/cache/${memoName("standard_female")}`;
    existingFiles.set(previous, 2048);

    await persistPreview(
      "file:///mock/cache/ekwe_speech_9.ogg",
      "standard_female",
    );

    expect(cacheDeletes).toContain(previous);
  });

  it("preserves the source extension rather than assuming Opus", async () => {
    existingFiles.set("file:///mock/cache/ekwe_speech_5.mp3", 512);

    const result = await persistPreview(
      "file:///mock/cache/ekwe_speech_5.mp3",
      "standard_male",
    );

    expect(result).toBe(
      `file:///mock/cache/ekwe_vpreview_v${VOICE_PREVIEW_VERSION}_standard_male.mp3`,
    );
  });

  it("falls back to the source when the move cannot happen", async () => {
    const source = "file:///mock/cache/ekwe_speech_gone.ogg";
    const result = await persistPreview(source, "standard_female");
    expect(result).toBe(source);
    expect(moves).toEqual([]);
  });
});

describe("clearStalePreviewCache", () => {
  it("retires older versions and keeps the current one", async () => {
    const staleUri = `file:///mock/cache/${memoName("standard_female", 0)}`;
    const currentUri = `file:///mock/cache/${memoName("studio_male")}`;
    existingFiles.set(staleUri, 2048);
    existingFiles.set(currentUri, 2048);

    mockDirEntries.push(
      new File(staleUri),
      new File(currentUri),
      new File("file:///mock/cache/photo.png"),
    );

    await clearStalePreviewCache();

    expect(cacheDeletes).toContain(staleUri);
    expect(cacheDeletes).not.toContain(currentUri);
    expect(cacheDeletes).not.toContain("file:///mock/cache/photo.png");
  });

  it("never throws when the cache cannot be listed", async () => {
    dirListThrows = true;
    await expect(clearStalePreviewCache()).resolves.toBeUndefined();
    expect(cacheDeletes).toEqual([]);
  });
});
