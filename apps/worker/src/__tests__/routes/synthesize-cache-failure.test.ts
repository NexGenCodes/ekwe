import { describe, test, expect, vi } from "vitest";

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));

// Only the read is faked. `buildSpeechCacheKey` and the write path stay real,
// because the point is that a failed read must not cost us the write.
vi.mock("@/services/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/speech")>();
  return {
    ...actual,
    readSpeechCache: vi.fn(async () => {
      throw new Error("KV unavailable");
    }),
  };
});

import { handleSynthesize } from "@/routes/synthesize";
import { readSpeechCache } from "@/services/speech";
import { mockEnv, mockExecutionContext, jsonResponse } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

function mp3Response(): Response {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return new Response(mp3, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

async function awaitWaitUntil(
  ctx: ReturnType<typeof mockExecutionContext>,
): Promise<void> {
  await Promise.all(
    (ctx as unknown as { _waitUntilFns: Promise<unknown>[] })._waitUntilFns,
  );
}

describe("speech cache read failure", () => {
  test("still writes the result so a read blip does not lose caching", async () => {
    // A single catch around the whole read used to collapse "read failed" and
    // "key could not be built" into the same empty key. An empty key is falsy,
    // so the cache write was silently skipped and this text stayed permanently
    // uncacheable after one transient KV error.
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: true,
          tier_active: "PREMIUM",
          quota_total: 5000,
          quota_remaining: 5000,
        }),
      ),
      http.post(PROVIDER_URLS.deepgramSpeak, () => mp3Response()),
      http.post(PROVIDER_URLS.witaiSynthesize, () => mp3Response()),
    );

    const env = mockEnv();
    const putSpy = vi.spyOn(env.EKWE_KV, "put");
    const ctx = mockExecutionContext();

    const res = await handleSynthesize(
      new Request("http://test/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Cache me later",
          sourceLang: "en",
          targetLang: "en",
        }),
      }),
      env,
      "PREMIUM",
      new AbortController().signal,
      { userId: "uid-cf", sessionId: null },
      ctx,
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(readSpeechCache)).toHaveBeenCalled();

    await awaitWaitUntil(ctx);
    // A real, tier-qualified speech key — not "".
    const speechPuts = putSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((k) => k.startsWith("speech:"));
    // One real, fully-qualified speech key was written — not "". The tier is
    // `free` because the Standard slot pins even a Premium user to the free
    // pool, which is the documented behaviour rather than a downgrade.
    expect(speechPuts).toHaveLength(1);
    expect(speechPuts[0]).toMatch(/^speech:[0-9a-f]{64}:standard:auto:free:/);
  });
});
