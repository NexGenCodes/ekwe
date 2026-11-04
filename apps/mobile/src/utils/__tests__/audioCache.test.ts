import { beforeEach, describe, expect, it, vi } from "vitest";
import { Directory, File } from "expo-file-system";

const cacheDeletes: string[] = [];
const nativeDeletes: string[] = [];
const mockDirEntries: unknown[] = [];
let dirListThrows = false;
let deleteThrows = false;
let isAndroidPlatform = false;
// URIs whose expo-side delete should fail, standing in for a file the native
// recorder still holds open.
const undeletableUris = new Set<string>();

vi.mock("@/utils", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/platform", () => ({
  get isIOS() {
    return false;
  },
  get isAndroid() {
    return isAndroidPlatform;
  },
}));

vi.mock("../../../modules/ekwe-native", () => ({
  default: {
    deleteFile: vi.fn(async (uri: string) => {
      if (deleteThrows) throw new Error("native delete failed");
      nativeDeletes.push(uri);
    }),
  },
}));

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
      if (undeletableUris.has(this.uri)) throw new Error("delete failed");
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
  sweepStaleAudioCache,
} from "@/utils/audioCache";

beforeEach(() => {
  cacheDeletes.length = 0;
  nativeDeletes.length = 0;
  mockDirEntries.length = 0;
  dirListThrows = false;
  deleteThrows = false;
  isAndroidPlatform = false;
  undeletableUris.clear();
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

  describe("on Android", () => {
    it("deletes a cache file once, not through both APIs", async () => {
      isAndroidPlatform = true;

      await cleanEchoCache("file:///mock/cache/ekwe_recording_1.ogg");

      // Regression guard: the native module resolves to the same
      // java.io.File.delete() as expo, so running both deleted every cache
      // recording twice.
      expect(cacheDeletes).toEqual(["file:///mock/cache/ekwe_recording_1.ogg"]);
      expect(nativeDeletes).toEqual([]);
    });

    it("falls back to the native module when the JS delete fails", async () => {
      isAndroidPlatform = true;
      undeletableUris.add("file:///mock/cache/locked.ogg");

      // The sweeper and session purge both rely on this surviving a file that
      // the recorder still holds open.
      await cleanEchoCache("file:///mock/cache/locked.ogg");

      expect(cacheDeletes).toEqual([]);
      expect(nativeDeletes).toEqual(["file:///mock/cache/locked.ogg"]);
    });

    it("still reaches the native module for paths outside the cache", async () => {
      isAndroidPlatform = true;

      await cleanEchoCache("file:///elsewhere/artifact.mp3");

      expect(cacheDeletes).toEqual([]);
      expect(nativeDeletes).toEqual(["file:///elsewhere/artifact.mp3"]);
    });

    it("never throws when the native delete fails", async () => {
      isAndroidPlatform = true;
      deleteThrows = true;

      await expect(
        cleanEchoCache("file:///elsewhere/artifact.mp3"),
      ).resolves.toBeUndefined();
    });
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

describe("sweepStaleAudioCache", () => {
  const entry = (uri: string, ageMs: number | null): File => {
    const file = new File(uri);
    file.modificationTime = ageMs === null ? null : Date.now() - ageMs;
    return file;
  };

  it("removes old Echo transients and leaves fresh or foreign files", async () => {
    const stale = entry(
      "file:///mock/cache/ekwe_speech_old.mp3",
      60 * 60 * 1000,
    );
    const recording = entry(
      "file:///mock/cache/ekwe_recording_abc.ogg",
      60 * 60 * 1000,
    );
    const fresh = entry("file:///mock/cache/ekwe_playback_fresh.m4a", 1000);
    const foreign = entry("file:///mock/cache/photo.png", 60 * 60 * 1000);
    mockDirEntries.push(
      stale,
      recording,
      fresh,
      foreign,
      entry("file:///mock/cache/ekwe_opus_old.ogg", 60 * 60 * 1000),
      entry("file:///mock/cache/ekwe_vorbis_old.ogg", 60 * 60 * 1000),
      entry("file:///mock/cache/ekwe_playback_old.m4a", 60 * 60 * 1000),
      entry("file:///mock/cache/PTT-20261105-WAtest.opus", 60 * 60 * 1000),
      new Directory("file:///mock/cache/sub"),
    );

    await sweepStaleAudioCache();

    expect(new Set(cacheDeletes)).toEqual(
      new Set([
        "file:///mock/cache/ekwe_speech_old.mp3",
        "file:///mock/cache/ekwe_recording_abc.ogg",
        "file:///mock/cache/ekwe_opus_old.ogg",
        "file:///mock/cache/ekwe_vorbis_old.ogg",
        "file:///mock/cache/ekwe_playback_old.m4a",
        "file:///mock/cache/PTT-20261105-WAtest.opus",
      ]),
    );
  });

  it("treats an unknown modification time as stale", async () => {
    mockDirEntries.push(entry("file:///mock/cache/ekwe_decoded_x.wav", null));

    await sweepStaleAudioCache();

    expect(cacheDeletes).toEqual(["file:///mock/cache/ekwe_decoded_x.wav"]);
  });

  it("never throws when the cache cannot be listed", async () => {
    dirListThrows = true;
    await expect(sweepStaleAudioCache()).resolves.toBeUndefined();
    expect(cacheDeletes).toEqual([]);
  });
});
