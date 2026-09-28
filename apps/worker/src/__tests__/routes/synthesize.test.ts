import { describe, test, expect, vi, type Mock } from "vitest";

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));
import { handleSynthesize } from "@/routes/synthesize";
import {
  mockEnv,
  makeAudioBlob,
  mockExecutionContext,
  jsonResponse,
} from "@/__tests__/setup";
import {
  VOICE_PREVIEW_TEXT,
  TRANSLATE_EXPANSION_CUSHION,
  PREMIUM_LIMITS,
  STUDIO_VOICE_ID,
} from "@ekwe/shared";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import type { Env, Tier } from "@/core/types";

function mp3Response(): Response {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return new Response(mp3, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

function envWithFailures(): Env {
  return mockEnv();
}

function aiMp3Env(): Env {
  server.use(
    http.post(PROVIDER_URLS.geminiTtsGenerate, () =>
      jsonResponse({ error: { code: 429, message: "throttled" } }, 429),
    ),
    http.post(PROVIDER_URLS.deepgramSpeak, () => mp3Response()),
    http.post(PROVIDER_URLS.witaiSynthesize, () => mp3Response()),
  );
  return mockEnv();
}

function gateOk(tier: Tier, quotaTotal: number, quotaRemaining: number): void {
  server.use(
    http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
      jsonResponse({
        allowed: true,
        tier_active: tier,
        quota_total: quotaTotal,
        quota_remaining: quotaRemaining,
      }),
    ),
  );
}

function gateExhausted(): void {
  server.use(
    http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
      jsonResponse({
        allowed: false,
        reason: "QUOTA_EXCEEDED",
        tier_active: "PREMIUM",
        quota_total: 5000,
        quota_remaining: 0,
      }),
    ),
  );
}

function textRequest(body: Record<string, unknown>): Request {
  return new Request("http://test/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function audioRequest(fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append("file", makeAudioBlob(), "test.wav");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("http://test/synthesize", {
    method: "POST",
    body: form,
  });
}

function handle(request: Request, env: Env, tier: Tier): Promise<Response> {
  return handleSynthesize(
    request,
    env,
    tier,
    new AbortController().signal,
    { userId: "uid-syn", sessionId: null },
    mockExecutionContext(),
  );
}

async function awaitWaitUntil(
  ctx: ReturnType<typeof mockExecutionContext>,
): Promise<void> {
  await Promise.all(
    (ctx as unknown as { _waitUntilFns: Promise<unknown>[] })._waitUntilFns,
  );
}

describe("handleSynthesize — gate/cache overlap", () => {
  test("reads the cache while the speech gate is still in flight", async () => {
    // Sequentially this was two round trips before any work could start.
    const order: string[] = [];
    let releaseGate: (() => void) | null = null;
    const gateBlocked = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async () => {
        order.push("gate:start");
        await gateBlocked;
        order.push("gate:end");
        return jsonResponse({
          allowed: true,
          tier_active: "PREMIUM",
          quota_total: 5000,
          quota_remaining: 5000,
        });
      }),
    );

    const env = aiMp3Env();
    const getSpy = vi.spyOn(env.EKWE_KV, "get");
    const ctx = mockExecutionContext();

    const pending = handleSynthesize(
      textRequest({ text: "Overlap me", sourceLang: "en", targetLang: "en" }),
      env,
      "PREMIUM",
      new AbortController().signal,
      { userId: "uid-ov", sessionId: null },
      ctx,
    );

    // Scope to the speech cache read: preflight also does a KV.get, before its
    // own RPC, so an unfiltered assertion would pass against sequential code.
    const speechGets = () =>
      getSpy.mock.calls.filter((c) => String(c[0]).startsWith("speech:"));

    await vi.waitFor(() => expect(speechGets().length).toBeGreaterThan(0));
    // The speech cache read was issued before the gate came back.
    expect(order).toContain("gate:start");
    expect(order).not.toContain("gate:end");

    releaseGate!();
    const res = await pending;
    expect(res.status).toBe(200);
  });

  test("re-reads the cache when the gate downgrades a Pro slot to FREE", async () => {
    // The speculative read used the slot tier in the key. For a Pro slot the
    // gate can still downgrade to FREE, so trusting that read would serve audio
    // cached under the wrong tier — and a cache "hit" would skip the gate
    // entirely on the next request.
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: true,
          tier_active: "FREE",
          throttled: true,
          quota_total: 5000,
          quota_remaining: 5000,
        }),
      ),
    );

    const env = aiMp3Env();
    const getSpy = vi.spyOn(env.EKWE_KV, "get");
    const ctx = mockExecutionContext();

    const res = await handleSynthesize(
      textRequest({
        text: "Downgrade me",
        sourceLang: "en",
        targetLang: "en",
        voiceId: "studio",
      }),
      env,
      "PREMIUM",
      new AbortController().signal,
      { userId: "uid-dg", sessionId: null },
      ctx,
    );

    expect(res.status).toBe(200);
    const keys = getSpy.mock.calls.map((c) => String(c[0]));
    // Premium slot: speculative key, then the correct FREE key.
    expect(keys.some((k) => k.includes("premium"))).toBe(true);
    expect(keys.some((k) => k.includes(":free:"))).toBe(true);
  });
});

describe("handleSynthesize — text branch", () => {
  test("missing sourceLang short-circuits translation and lazily reserves the gate", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();

    const res = await handle(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.translated).toBe(false);

    expect(body.sourceLang).toBe("es");
    expect(body.targetLang).toBe("es");
    expect(body.voiceId).toBe("standard");
    expect(body.mime).toBe("audio/mpeg");
    expect(body.durationMs).toBeUndefined();
    // Delivery is always a URL into the speech cache, never inline bytes.
    expect(body.audioUrl).toMatch(/^\/speech\/speech:[^/]+$/);
  });

  test("collapses concurrent identical requests into one provider call", async () => {
    gateOk("PREMIUM", 5000, 5000);

    const env = aiMp3Env();

    // Counted at the network edge rather than by mocking the provider, so this
    // measures what the biller would actually see. Registered after `aiMp3Env`
    // because msw takes the most recently registered handler for a route.
    let providerCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.witaiSynthesize, () => {
        providerCalls += 1;
        return mp3Response();
      }),
    );

    const results = await Promise.all([
      handle(
        textRequest({ text: "Collapse me", targetLang: "es" }),
        env,
        "PREMIUM",
      ),
      handle(
        textRequest({ text: "Collapse me", targetLang: "es" }),
        env,
        "PREMIUM",
      ),
      handle(
        textRequest({ text: "Collapse me", targetLang: "es" }),
        env,
        "PREMIUM",
      ),
    ]);

    for (const res of results) expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
  });

  test("charges the flat speech conversion pool on live synthesis", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();

    let sentChars = -1;
    server.use(
      http.post(PROVIDER_URLS.supabaseConsumeUsage, async ({ request }) => {
        const data = (await request.json()) as any;
        sentChars = data.p_chars;
        return jsonResponse({});
      }),
    );

    const ctx = mockExecutionContext();
    const res = await handleSynthesize(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
      new AbortController().signal,
      { userId: "uid-syn", sessionId: null },
      ctx,
    );
    await awaitWaitUntil(ctx);
    expect(res.status).toBe(200);

    // B7: char-based metering — "Hello world" is 11 characters
    expect(sentChars).toBe(11);
  });

  test("rejects when the flat conversion pool is exhausted", async () => {
    gateExhausted();
    const env = envWithFailures();
    let speakCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.deepgramSpeak, () => {
        speakCalls++;
        return mp3Response();
      }),
    );

    const res = await handle(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = (await res.json()) as any;
    expect(body.error).toBe("EKWE_QUOTA_EXCEEDED");
    expect(body.quota_total).toBe(5000);

    expect(env.AI.run).not.toHaveBeenCalled();
    expect(speakCalls).toBe(0);
  });

  test("explicit sourceLang translates before speech", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();
    let geminiTranslateCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () => {
        geminiTranslateCalls++;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola mundo" }] } }],
        });
      }),
    );

    const res = await handle(
      textRequest({ text: "Hello world", sourceLang: "en", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.translated).toBe(true);
    expect(body.sourceLang).toBe("en");
    expect(body.targetLang).toBe("es");

    expect(geminiTranslateCalls).toBe(1);
  });

  test("sourceLang equal to targetLang skips translation and speaks verbatim", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();
    let geminiTranslateCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () => {
        geminiTranslateCalls++;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola mundo" }] } }],
        });
      }),
    );

    const res = await handle(
      textRequest({ text: "Hello world", sourceLang: "es", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.translated).toBe(false);
    expect(body.sourceLang).toBe("es");
    expect(body.targetLang).toBe("es");

    expect(geminiTranslateCalls).toBe(0);
  });

  test("reserve gate failure blocks translation before any provider work", async () => {
    gateExhausted();
    const env = envWithFailures();
    let geminiTranslateCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () => {
        geminiTranslateCalls++;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola" }] } }],
        });
      }),
    );

    const res = await handle(
      textRequest({ text: "Hello world", sourceLang: "en", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(429);
    expect(geminiTranslateCalls).toBe(0);
  });

  test("auto-detect is 403 for FREE tier", async () => {
    const res = await handle(
      textRequest({
        text: "Hello world",
        sourceLang: "auto",
        targetLang: "es",
      }),
      aiMp3Env(),
      "FREE",
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toBe("AUTO_DETECT_UNAVAILABLE");
  });

  test("rejects targetLang auto (schema enum)", async () => {
    const res = await handle(
      textRequest({ text: "Hello", targetLang: "auto" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("INVALID_BODY");
  });

  test("rejects empty / whitespace text", async () => {
    const res = await handle(
      textRequest({ text: "   ", targetLang: "es" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("EKWE_EMPTY_TRANSCRIPT");
  });

  test("rejects an unknown voiceId", async () => {
    const res = await handle(
      textRequest({ text: "Hello", targetLang: "es", voiceId: "not-a-voice" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("INVALID_BODY");
  });

  test("rejects a neutral gender (male/female only)", async () => {
    const textRes = await handle(
      textRequest({ text: "Hello", targetLang: "es", gender: "neutral" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(textRes.status).toBe(400);
    expect(((await textRes.json()) as any).error).toBe("INVALID_BODY");

    const audioRes = await handle(
      audioRequest({ gender: "neutral", lang: "en", targetLang: "es" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(audioRes.status).toBe(400);
    expect(((await audioRes.json()) as any).error).toBe("INVALID_BODY");
  });

  test("rejects text over the speech character cap", async () => {
    const res = await handle(
      textRequest({ text: "a".repeat(2401), targetLang: "es" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("INVALID_BODY");
  });

  test("preview text is free: no gate, no charge, pinned to en", async () => {
    const ctx = mockExecutionContext();
    let consumeCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.supabaseConsumeUsage, () => {
        consumeCalls++;
        return jsonResponse({});
      }),
    );

    const res = await handleSynthesize(
      textRequest({
        text: VOICE_PREVIEW_TEXT,
        sourceLang: "es",
        targetLang: "fr",
      }),
      aiMp3Env(),
      "FREE",
      new AbortController().signal,
      { userId: "uid-syn", sessionId: null },
      ctx,
    );
    await awaitWaitUntil(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.translated).toBe(false);

    expect(body.sourceLang).toBe("es");
    expect(body.targetLang).toBe("fr");
    expect(consumeCalls).toBe(0);
  });

  test("returns 503 when every speech provider fails", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = envWithFailures();
    const res = await handle(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("SPEECH_UNAVAILABLE");
  });
});

describe("handleSynthesize — audio branch", () => {
  test("transcribes, translates, then speaks", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();
    let witCalls = 0;
    let geminiTranslateCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        witCalls++;
        return jsonResponse({ text: "wit result" });
      }),
      http.post(PROVIDER_URLS.geminiGenerate, () => {
        geminiTranslateCalls++;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola mundo" }] } }],
        });
      }),
    );

    const res = await handle(
      audioRequest({ lang: "en", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.translated).toBe(true);
    expect(body.sourceLang).toBe("en");
    expect(body.targetLang).toBe("es");
    expect(witCalls).toBe(1);
    expect(geminiTranslateCalls).toBe(1);
  });

  test("same source and target langs skip translation and speak verbatim", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();
    let witCalls = 0;
    let geminiTranslateCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        witCalls++;
        return jsonResponse({ text: "wit result" });
      }),
      http.post(PROVIDER_URLS.geminiGenerate, () => {
        geminiTranslateCalls++;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola mundo" }] } }],
        });
      }),
    );

    const res = await handle(
      audioRequest({ lang: "es", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.translated).toBe(false);
    expect(body.sourceLang).toBe("es");
    expect(body.targetLang).toBe("es");

    expect(witCalls).toBe(1);
    expect(geminiTranslateCalls).toBe(0);
  });

  test("second identical request is served from every cache layer", async () => {
    gateOk("PREMIUM", 5000, 5000);
    const env = aiMp3Env();
    let witCalls = 0;
    let geminiTranslateCalls = 0;
    let speakCalls = 0;
    let freeSpeakCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        witCalls++;
        return jsonResponse({ text: "wit result" });
      }),
      http.post(PROVIDER_URLS.geminiGenerate, () => {
        geminiTranslateCalls++;
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola mundo" }] } }],
        });
      }),
      http.post(PROVIDER_URLS.deepgramSpeak, () => {
        speakCalls++;
        return mp3Response();
      }),
      http.post(PROVIDER_URLS.witaiSynthesize, () => {
        freeSpeakCalls++;
        return mp3Response();
      }),
    );
    const fields = { lang: "en", targetLang: "es" };

    const first = await handle(audioRequest(fields), env, "PREMIUM");
    expect(first.status).toBe(200);

    const second = await handle(audioRequest(fields), env, "PREMIUM");
    expect(second.status).toBe(200);
    const body = (await second.json()) as any;
    expect(body.translated).toBe(true);

    expect(witCalls).toBe(1);
    expect(geminiTranslateCalls).toBe(1);
    // No voiceId means Standard, which is the free pool even for a Pro
    // account, so synthesis must not reach a premium provider.
    expect(freeSpeakCalls).toBe(1);
    expect(speakCalls).toBe(0);
  });

  test("returns 400 MISSING_FILE without a file part", async () => {
    const form = new FormData();
    form.append("lang", "en");
    form.append("targetLang", "es");
    const res = await handle(
      new Request("http://test/synthesize", { method: "POST", body: form }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("MISSING_FILE");
  });

  test("requires a concrete targetLang (auto rejected)", async () => {
    const res = await handle(
      audioRequest({ lang: "en", targetLang: "auto" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("INVALID_TARGET_LANGUAGE");
  });

  test("rejects an unknown multipart voiceId", async () => {
    const res = await handle(
      audioRequest({ lang: "en", targetLang: "es", voiceId: "nope" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("INVALID_BODY");
  });

  test("reserve gate failure blocks transcription", async () => {
    gateExhausted();
    const env = envWithFailures();
    let witCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        witCalls++;
        return jsonResponse({ text: "wit result" });
      }),
    );

    const res = await handle(
      audioRequest({ lang: "en", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(429);
    expect(witCalls).toBe(0);
  });

  test("auto lang is 403 for FREE before any gate or transcription", async () => {
    const env = aiMp3Env();
    const res = await handle(
      audioRequest({ lang: "auto", targetLang: "es" }),
      env,
      "FREE",
    );
    expect(res.status).toBe(403);
    expect(env.AI.run).not.toHaveBeenCalled();
  });
});

describe("transcript and translation stay consistent", () => {
  test("reports the same span it translated when the source is over the limit", async () => {
    gateOk("PREMIUM", 5000, 5000);
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, () =>
        jsonResponse({ error: { code: 429, message: "throttled" } }, 429),
      ),
      http.post(PROVIDER_URLS.deepgramSpeak, () => mp3Response()),
      http.post(PROVIDER_URLS.witaiSynthesize, () => mp3Response()),
    );

    const env = mockEnv();
    const ai = env.AI as unknown as { run: Mock };
    const baseImpl = ai.run.getMockImplementation();
    ai.run.mockImplementation(async (model: string, input: unknown) => {
      if (model === "@cf/zai-org/glm-4.7-flash") {
        return { choices: [{ message: { content: "hola" } }] };
      }
      return (baseImpl as ((m: string, i: unknown) => unknown) | undefined)?.(
        model,
        input,
      );
    });

    const limit = Math.floor(
      PREMIUM_LIMITS.maxTextChars / TRANSLATE_EXPANSION_CUSHION,
    );
    const long = "a".repeat(limit + 100);
    const res = await handle(
      textRequest({ text: long, sourceLang: "en", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      transcript?: string;
      translation?: string | null;
    };
    expect(body.translation).toBe("hola");
    expect(body.transcript).toBe(long.slice(0, limit));
  });
});

describe("premium voice entitlement", () => {
  test("a FREE user asking for a Studio voice never reaches the preflight gate", async () => {
    let preflightCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () => {
        preflightCalls++;
        return jsonResponse({
          allowed: true,
          tier_active: "FREE",
          quota_total: 5000,
          quota_remaining: 5000,
        });
      }),
    );

    const res = await handle(
      textRequest({
        text: "hola",
        sourceLang: "es",
        targetLang: "es",
        voiceId: STUDIO_VOICE_ID,
      }),
      aiMp3Env(),
      "FREE",
    );
    expect(res.status).toBe(403);
    expect(preflightCalls).toBe(0);
  });
});
