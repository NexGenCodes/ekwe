import { describe, test, expect, vi, type Mock } from "vitest";

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));
import { synthesizeFromAudio, synthesizeFromText } from "@/routes/synthesize";
import {
  jsonBody,
  jsonResponse,
  makeAudioBlob,
  mockEnv,
  mockExecutionContext,
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

/**
 * Sized past the provider floor rather than being a token 8-byte frame: Wit
 * returns 576 bytes of silence for a script it cannot speak, so anything under
 * that is rejected rather than served. A realistic fixture keeps these tests
 * exercising the route instead of the guard.
 */
function mp3Response(): Response {
  return new Response(new Uint8Array(4_096), {
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

/**
 * An env whose cooldown claim always misses: the row exists and is inside the
 * window, so the gate answers 429 without touching any provider.
 */
async function cooldownEnv(): Promise<Env> {
  const env = envWithFailures();
  // Seed a fresh cooldown timestamp so the gate denies the next request.
  await env.EKWE_KV.put("cdwn:uid-syn", String(Date.now()), {
    expirationTtl: 60,
  });
  return env;
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
  form.append("duration", "1000");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("http://test/synthesize", {
    method: "POST",
    body: form,
  });
}

import { RequestTimings } from "@/core/timing";
import { SYNTHESIZE_TOTAL_MS } from "@/core/budgets";
import { createGateCharge } from "@/routes/synthesize";
import { synthesizeRequestSchema } from "@ekwe/shared";

function handle(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal = new AbortController().signal,
  authContext: { userId: string; sessionId: string | null } = {
    userId: "uid-syn",
    sessionId: null,
  },
  ctx: ExecutionContext = mockExecutionContext(),
): Promise<Response> {
  const start = Date.now();
  const remainingMs = () => SYNTHESIZE_TOTAL_MS - (Date.now() - start);
  const timings = new RequestTimings();
  const gateCharge = createGateCharge();
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    return synthesizeFromAudio(
      request,
      env,
      tier,
      signal,
      authContext.userId,
      ctx,
      remainingMs,
      timings,
      gateCharge,
    );
  }

  return request.json().then((body) => {
    const parsed = synthesizeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "INVALID_BODY" }, { status: 400 });
    }
    return synthesizeFromText(
      parsed.data,
      env,
      tier,
      signal,
      authContext.userId,
      ctx,
      remainingMs,
      timings,
      gateCharge,
    );
  });
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
    const order: string[] = [];
    let releaseGate: (() => void) | null = null;
    const gateBlocked = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const env = aiMp3Env();

    // Capture the underlying vi.fn mock BEFORE replacing, so the wrapper
    // delegates to the real in-memory store without looping back through itself.
    const realGet = env.EKWE_KV.get;
    const getSpy = vi.fn(
      async (key: unknown, opts?: unknown): Promise<unknown> => {
        if (typeof key === "string" && key.startsWith("cdwn:")) {
          order.push("gate:start");
          await gateBlocked;
          order.push("gate:end");
        }
        return Reflect.apply(realGet, env.EKWE_KV, [key, opts]);
      },
    );
    env.EKWE_KV.get = getSpy as unknown as typeof env.EKWE_KV.get;

    const ctx = mockExecutionContext();

    const pending = handle(
      textRequest({ text: "Overlap me", sourceLang: "en", targetLang: "en" }),
      env,
      "PREMIUM",
      new AbortController().signal,
      { userId: "uid-ov", sessionId: null },
      ctx,
    );

    const speechGets = () =>
      getSpy.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" && (c[0] as string).startsWith("speech:"),
      );

    await vi.waitFor(() => expect(speechGets().length).toBeGreaterThan(0));
    expect(order).toContain("gate:start");
    expect(order).not.toContain("gate:end");

    releaseGate!();
    const res = await pending;
    expect(res.status).toBe(200);
  });
});

describe("handleSynthesize — text branch", () => {
  test("missing sourceLang short-circuits translation and lazily reserves the gate", async () => {
    const env = aiMp3Env();

    const res = await handle(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);

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

  test("records the spoken characters as speech usage", async () => {
    const env = aiMp3Env();
    const baseDb = env.DB;
    let speechChars = -1;

    env.DB = {
      prepare: (sql: string) => {
        const statement = baseDb.prepare(sql) as unknown as {
          bind: (...args: unknown[]) => unknown;
        };
        if (!/user_daily_usage/i.test(sql)) return statement;
        return {
          bind: (...args: unknown[]) => {
            // (user_id, day, translate, transcribe, transcribe_ms,
            //  speech_chars, stream, stream_ms, credits, now)
            speechChars = args[5] as number;
            return statement.bind(...args);
          },
        };
      },
      batch: baseDb.batch.bind(baseDb),
    } as unknown as Env["DB"];

    const ctx = mockExecutionContext();
    const res = await handle(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
      new AbortController().signal,
      { userId: "uid-syn", sessionId: null },
      ctx,
    );
    await awaitWaitUntil(ctx);
    expect(res.status).toBe(200);

    // Char-based metering — "Hello world" is 11 characters.
    expect(speechChars).toBe(11);
  });

  test("rejects inside the cooldown window before speaking", async () => {
    const env = await cooldownEnv();
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
    const body = await jsonBody(res);
    expect(body.error).toBe("EKWE_RATE_LIMIT");

    expect(env.AI.run).not.toHaveBeenCalled();
    expect(speakCalls).toBe(0);
  });

  test("explicit sourceLang translates before speech", async () => {
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
    const body = await jsonBody(res);
    expect(body.translated).toBe(true);
    expect(body.sourceLang).toBe("en");
    expect(body.targetLang).toBe("es");

    expect(geminiTranslateCalls).toBe(1);
  });

  test("sourceLang equal to targetLang skips translation and speaks verbatim", async () => {
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
    const body = await jsonBody(res);
    expect(body.translated).toBe(false);
    expect(body.sourceLang).toBe("es");
    expect(body.targetLang).toBe("es");

    expect(geminiTranslateCalls).toBe(0);
  });

  test("reserve gate failure blocks translation before any provider work", async () => {
    const env = await cooldownEnv();
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
    const body = await jsonBody(res);
    expect(body.error).toBe("AUTO_DETECT_UNAVAILABLE");
  });

  test("rejects targetLang auto (schema enum)", async () => {
    const res = await handle(
      textRequest({ text: "Hello", targetLang: "auto" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("INVALID_BODY");
  });

  test("rejects empty / whitespace text", async () => {
    const res = await handle(
      textRequest({ text: "   ", targetLang: "es" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("EKWE_EMPTY_TRANSCRIPT");
  });

  test("rejects an unknown voiceId", async () => {
    const res = await handle(
      textRequest({ text: "Hello", targetLang: "es", voiceId: "not-a-voice" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("INVALID_BODY");
  });

  test("rejects a neutral gender (male/female only)", async () => {
    const textRes = await handle(
      textRequest({ text: "Hello", targetLang: "es", gender: "neutral" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(textRes.status).toBe(400);
    expect((await jsonBody(textRes)).error).toBe("INVALID_BODY");

    const audioRes = await handle(
      audioRequest({ gender: "neutral", lang: "en", targetLang: "es" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(audioRes.status).toBe(400);
    expect((await jsonBody(audioRes)).error).toBe("INVALID_BODY");
  });

  test("rejects text over the speech character cap", async () => {
    const res = await handle(
      textRequest({ text: "a".repeat(2401), targetLang: "es" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("INVALID_BODY");
  });

  test("preview text is no longer special-cased: it runs the gated path", async () => {
    const env = aiMp3Env();
    let kvPuts = 0;
    const basePut = env.EKWE_KV.put.bind(env.EKWE_KV);
    vi.spyOn(env.EKWE_KV, "put").mockImplementation(
      async (key: string, value: unknown, opts?: unknown) => {
        if (String(key).startsWith("cdwn:")) kvPuts++;
        return basePut(
          key,
          value as string,
          opts as { expirationTtl?: number },
        );
      },
    );

    const res = await handle(
      textRequest({
        text: VOICE_PREVIEW_TEXT,
        sourceLang: "fr",
        targetLang: "fr",
      }),
      env,
      "FREE",
    );
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).translated).toBe(false);
    expect(kvPuts).toBeGreaterThan(0);
  });

  test("returns 503 when every speech provider fails", async () => {
    const env = envWithFailures();
    const res = await handle(
      textRequest({ text: "Hello world", targetLang: "es" }),
      env,
      "PREMIUM",
    );
    expect(res.status).toBe(503);
    const body = await jsonBody(res);
    expect(body.error).toBe("SPEECH_UNAVAILABLE");
  });
});

describe("handleSynthesize — audio branch", () => {
  test("transcribes, translates, then speaks", async () => {
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
    const body = await jsonBody(res);
    expect(body.translated).toBe(true);
    expect(body.sourceLang).toBe("en");
    expect(body.targetLang).toBe("es");
    expect(witCalls).toBe(1);
    expect(geminiTranslateCalls).toBe(1);
  });

  test("same source and target langs skip translation and speak verbatim", async () => {
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
    const body = await jsonBody(res);
    expect(body.translated).toBe(false);
    expect(body.sourceLang).toBe("es");
    expect(body.targetLang).toBe("es");

    expect(witCalls).toBe(1);
    expect(geminiTranslateCalls).toBe(0);
  });

  test("second identical request is served from every cache layer", async () => {
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

    const baseDb = env.DB;
    const usage = { translate: 0, transcribe: 0, speech: 0 };
    env.DB = {
      prepare: (sql: string) => {
        const statement = baseDb.prepare(sql) as unknown as {
          bind: (...args: unknown[]) => unknown;
        };
        if (!/user_daily_usage/i.test(sql)) return statement;
        return {
          bind: (...args: unknown[]) => {
            usage.translate += (args[2] as number) ?? 0;
            usage.transcribe += (args[3] as number) ?? 0;
            usage.speech += (args[5] as number) ?? 0;
            return statement.bind(...args);
          },
        };
      },
      batch: baseDb.batch.bind(baseDb),
    } as unknown as Env["DB"];

    const auth = { userId: "uid-cache", sessionId: null };
    const ctx = mockExecutionContext();
    const first = await handle(
      audioRequest(fields),
      env,
      "PREMIUM",
      new AbortController().signal,
      auth,
      ctx,
    );
    await awaitWaitUntil(ctx);
    expect(first.status).toBe(200);
    expect(usage).toEqual({ translate: 1, transcribe: 1, speech: 10 });

    // Reset KV cooldown so the second request isn't rate-limited.
    await env.EKWE_KV.delete("cdwn:uid-cache");

    const second = await handle(
      audioRequest(fields),
      env,
      "PREMIUM",
      new AbortController().signal,
      auth,
      ctx,
    );
    await awaitWaitUntil(ctx);
    expect(second.status).toBe(200);
    const body = await jsonBody(second);
    expect(body.translated).toBe(true);

    expect(usage).toEqual({ translate: 1, transcribe: 1, speech: 10 });
    expect(witCalls).toBe(1);
    expect(geminiTranslateCalls).toBe(1);
    // Standard slot → free pool even for PREMIUM, must not hit Deepgram.
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
    const body = await jsonBody(res);
    expect(body.error).toBe("MISSING_FILE");
  });

  test("requires a concrete targetLang (auto rejected)", async () => {
    const res = await handle(
      audioRequest({ lang: "en", targetLang: "auto" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("INVALID_TARGET_LANGUAGE");
  });

  test("rejects an unknown multipart voiceId", async () => {
    const res = await handle(
      audioRequest({ lang: "en", targetLang: "es", voiceId: "nope" }),
      aiMp3Env(),
      "PREMIUM",
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("INVALID_BODY");
  });

  test("reserve gate failure blocks transcription", async () => {
    const env = await cooldownEnv();
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
  test("a FREE user asking for a Studio voice never reaches the cooldown gate", async () => {
    const env = aiMp3Env();
    const baseDb = env.DB;
    let claims = 0;
    env.DB = {
      prepare: (sql: string) => {
        if (/user_cooldowns/i.test(sql)) claims++;
        return baseDb.prepare(sql);
      },
    } as unknown as Env["DB"];

    const res = await handle(
      textRequest({
        text: "hola",
        sourceLang: "es",
        targetLang: "es",
        voiceId: STUDIO_VOICE_ID,
      }),
      env,
      "FREE",
    );
    expect(res.status).toBe(403);
    expect(claims).toBe(0);
  });
});
