import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/speech")>();
  return { ...actual, readSpeechCache: vi.fn(async () => null) };
});

import { speechAudioHandler, isSpeechCacheKey } from "@/routes/speech-audio";
import { readSpeechCache } from "@/services/speech";
import { signSpeechUrl } from "@/utils/speech-url";
import { mockEnv } from "@/__tests__/setup";
import type { Env } from "@/core/types";

const mockedRead = vi.mocked(readSpeechCache);

const CACHE_KEY = `speech:${"a".repeat(64)}:standard:auto:free:cache:en:${"b".repeat(64)}`;

async function signedKey(key = CACHE_KEY): Promise<string> {
  return signSpeechUrl(mockEnv() as Env, key);
}

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

    const res = await call(await signedKey());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Content-Length")).toBe(String(audio.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(audio);
  });

  test("looks the cache up under the unsigned key", async () => {
    await call(await signedKey());
    expect(mockedRead).toHaveBeenCalledWith(expect.anything(), CACHE_KEY);
  });

  test("404s a well-formed key that is not in the cache", async () => {
    const res = await call(await signedKey());
    expect(res.status).toBe(404);
  });

  test("404s a valid key carrying the wrong signature", async () => {
    const forged = `${CACHE_KEY}.${"0".repeat(32)}`;
    expect(isSpeechCacheKey(forged)).toBe(true);
    const res = await call(forged);
    expect(res.status).toBe(404);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  test("404s a signature minted for a different key", async () => {
    const other = `speech:shared:remi:male:premium:cache:es:${"c".repeat(64)}`;
    const sig = (await signedKey(other)).slice(other.length + 1);
    const res = await call(`${CACHE_KEY}.${sig}`);
    expect(res.status).toBe(404);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  test("rejects keys that are not shaped like a speech cache key", async () => {
    for (const bad of [
      "",
      "../../secrets",
      "speech:shared:standard:auto:free:cache:en",
      `speech:${"a".repeat(64)}:standard:auto:free:cache:en:NOTHASH`,
      "notspeech:whatever",
      CACHE_KEY,
    ]) {
      const res = await call(bad);
      expect(res.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(400);
    }
    expect(mockedRead).not.toHaveBeenCalled();
  });

  test("accepts both the shared-scope and user-scope key shapes and reroll variants", async () => {
    expect(isSpeechCacheKey(await signedKey())).toBe(true);
    expect(
      isSpeechCacheKey(
        await signedKey(
          `speech:shared:remi:male:premium:cache:es:${"c".repeat(64)}`,
        ),
      ),
    ).toBe(true);
    expect(
      isSpeechCacheKey(
        await signedKey(
          `speech:${"a".repeat(64)}:standard:auto:free:cache:en:${"b".repeat(64)}:r1`,
        ),
      ),
    ).toBe(true);
  });
});
