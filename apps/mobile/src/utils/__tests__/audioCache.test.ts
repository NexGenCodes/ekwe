import { beforeEach, describe, expect, it, vi } from "vitest";
import { Directory, File } from "expo-file-system";

const cacheDeletes: string[] = [];
const mockDirEntries: unknown[] = [];
let dirListThrows = false;

vi.mock("@/utils", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/platform", () => ({ isIOS: false, isAndroid: false }));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    name: string;
    modificationTime: number | null = null;
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
      if (dirListThrows) throw new Error("cache unavailable");
      return mockDirEntries;
    }
  },
  Paths: { cache: { uri: "file:///mock/cache/" } },
}));

import {
  cleanAudioArtifacts,
  cleanEchoCache,
  sweepStaleEchoCache,
} from "@/utils/audioCache";

beforeEach(() => {
  cacheDeletes.length = 0;
  mockDirEntries.length = 0;
  dirListThrows = false;
});

describe("cleanEchoCache", () => {
  it("deletes a cache file", async () => {
    await cleanEchoCache("file:///mock/cache/artifact.mp3");
    expect(cacheDeletes).toEqual(["file:///mock/cache/artifact.mp3"]);
  });

  it("refuses to touch files outside the cache", async () => {
    await cleanEchoCache("file:///elsewhere/artifact.mp3");
    expect(cacheDeletes).toEqual([]);
  });
});

describe("cleanAudioArtifacts", () => {
  it("removes every container sibling of an Ogg recording", async () => {
    await cleanAudioArtifacts("file:///mock/cache/note.ogg");

    expect(new Set(cacheDeletes)).toEqual(
      new Set([
        "file:///mock/cache/note.ogg",
        "file:///mock/cache/note.caf",
        "file:///mock/cache/note.wav",
      ]),
    );
  });

  it("expands siblings when handed the iOS CAF sibling", async () => {
    await cleanAudioArtifacts("file:///mock/cache/note.caf");

    expect(new Set(cacheDeletes)).toEqual(
      new Set([
        "file:///mock/cache/note.ogg",
        "file:///mock/cache/note.caf",
        "file:///mock/cache/note.wav",
      ]),
    );
  });

  it("only deletes the single file for a non-container artifact", async () => {
    await cleanAudioArtifacts("file:///mock/cache/tts-123.mp3");
    expect(cacheDeletes).toEqual(["file:///mock/cache/tts-123.mp3"]);
  });

  it("never deletes a non-cache path", async () => {
    await cleanAudioArtifacts("file:///elsewhere/note.ogg");
    expect(cacheDeletes).toEqual([]);
  });

  it("is a no-op for empty input", async () => {
    await cleanAudioArtifacts(null);
    await cleanAudioArtifacts(undefined);
    expect(cacheDeletes).toEqual([]);
  });
});

describe("sweepStaleEchoCache", () => {
  const entry = (uri: string, ageMs: number | null): File => {
    const file = new File(uri);
    file.modificationTime = ageMs === null ? null : Date.now() - ageMs;
    return file;
  };

  it("removes old Echo transients and leaves fresh or foreign files", async () => {
    const stale = entry("file:///mock/cache/ekwe_tts_old.mp3", 60 * 60 * 1000);
    const recording = entry(
      "file:///mock/cache/ekwe_recording_abc.ogg",
      60 * 60 * 1000,
    );
    const fresh = entry("file:///mock/cache/ekwe_remuxed_new.caf", 1000);
    const foreign = entry("file:///mock/cache/photo.png", 60 * 60 * 1000);
    mockDirEntries.push(
      stale,
      recording,
      fresh,
      foreign,
      new Directory("file:///mock/cache/sub"),
    );

    await sweepStaleEchoCache();

    expect(new Set(cacheDeletes)).toEqual(
      new Set([
        "file:///mock/cache/ekwe_tts_old.mp3",
        "file:///mock/cache/ekwe_recording_abc.ogg",
      ]),
    );
  });

  it("treats an unknown modification time as stale", async () => {
    mockDirEntries.push(entry("file:///mock/cache/ekwe_decoded_x.wav", null));

    await sweepStaleEchoCache();

    expect(cacheDeletes).toEqual(["file:///mock/cache/ekwe_decoded_x.wav"]);
  });

  it("never throws when the cache cannot be listed", async () => {
    dirListThrows = true;
    await expect(sweepStaleEchoCache()).resolves.toBeUndefined();
    expect(cacheDeletes).toEqual([]);
  });
});
