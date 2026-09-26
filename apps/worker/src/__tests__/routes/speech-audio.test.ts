import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/speech")>();
  return { ...actual, readSpeechCache: vi.fn(async () => null) };
});

import { speechAudioHandler, isSpeechCacheKey } from "@/routes/speech-audio";
import { readSpeechCache } from "@/services/speech";
import { mockEnv } from "@/__tests__/setup";
import type { Env } from "@/core/types";

const mockedRead = vi.mocked(readSpeechCache);

/** Mirrors the real composite key shape from `buildSpeechCacheKey`. */
const KEY = `speech:${"a".repeat(64)}:standard:auto:free:cache:en:${"b".repeat(64)}`;

function call(key: string): Promise<Response> {
  return Promise.resolve(
    speechAudioHandler({
      request: new Request(`http://test/speech/${key}`),
      env: mockEnv() as Env,
      ctx: {} as never,
      params: { key },
      timings: {} as never,
    }),
  );
}

describe("GET /speech/:key", () => {
  beforeEach(() => {
    mockedRead.mockReset();
    mockedRead.mockResolvedValue(null);
  });

  test("serves cached audio with the stored mime type", async () => {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
    mockedRead.mockResolvedValue({
      audio,
      mime: "audio/mpeg",
      provider: "edge",
    });

    const res = await call(KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Content-Length")).toBe(String(audio.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(audio);
  });

  test("404s a well-formed key that is not in the cache", async () => {
    const res = await call(KEY);
    expect(res.status).toBe(404);
  });

  test("rejects keys that are not shaped like a speech cache key", async () => {
    // Guards the bucket against a caller naming an arbitrary object.
    for (const bad of [
      "",
      "../../secrets",
      "speech:shared:standard:auto:free:cache:en",
      `speech:${"a".repeat(64)}:standard:auto:free:cache:en:NOTHASH`,
      "notspeech:whatever",
    ]) {
      const res = await call(bad);
      expect(res.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(400);
    }
    expect(mockedRead).not.toHaveBeenCalled();
  });

  test("accepts both the shared-scope and user-scope key shapes", () => {
    expect(isSpeechCacheKey(KEY)).toBe(true);
    expect(
      isSpeechCacheKey(
        `speech:shared:remi:male:premium:cache:es:${"c".repeat(64)}`,
      ),
    ).toBe(true);
  });
});
