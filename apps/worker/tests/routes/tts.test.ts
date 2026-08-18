import { describe, test, expect, vi } from "vitest";
import { handleTts } from "../../src/routes/tts";
import { mockEnv, jsonResponse } from "../setup";
import { bytesToBase64 } from "../../src/utils/base64";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

function mp3Response(): Response {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return new Response(mp3, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

// Model routed to the deepgram provider module for en (Aura 2 voice).
const MELOTTS_AI_MODEL = "@cf/myshell-ai/melotts";

function makeRequest(text = "Hello world", lang = "es"): Request {
  return new Request("http://test/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
}

function geminiInlineResponse(): Response {
  const pcm = new Int16Array(480);
  for (let i = 0; i < 480; i++) {
    pcm[i] = Math.round(Math.sin(i / 8) * 1000);
  }
  const bytes = new Uint8Array(pcm.buffer);
  return jsonResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/L16;codec=pcm;rate=24000",
                data: bytesToBase64(bytes),
              },
            },
          ],
        },
      },
    ],
  });
}

function geminiError(status: number): Response {
  return jsonResponse({ error: { code: status, message: "err" } }, status);
}

describe("handleTts", () => {
  test("FREE tier is rejected with 403", async () => {
    const res = await handleTts(
      makeRequest(),
      mockEnv(),
      "FREE",
      new AbortController().signal,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("PREMIUM_FEATURE_REQUIRED");
  });

  test("returns 400 when language is missing or auto", async () => {
    const missingLang = new Request("http://test/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    const missingRes = await handleTts(
      missingLang,
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
    );
    expect(missingRes.status).toBe(400);

    const autoRes = await handleTts(
      makeRequest("Hello", "auto"),
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
    );
    expect(autoRes.status).toBe(400);
  });

  test("returns 400 on invalid language code", async () => {
    const res = await handleTts(
      makeRequest("Hello", "xx"),
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 on empty text", async () => {
    const res = await handleTts(
      makeRequest("   "),
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(400);
  });

  test("returns 413 when text exceeds the speech character cap", async () => {
    const res = await handleTts(
      makeRequest("a".repeat(1001)),
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(413);
  });

  test("synthesizes WAV via gemini for a supported language", async () => {
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, geminiInlineResponse),
    );

    const res = await handleTts(
      makeRequest("Hello world", "es"),
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(res.headers.get("X-TTS-Provider")).toBe("gemini");
    expect(res.headers.get("X-TTS-Cache")).toBe("MISS");

    const audio = new Uint8Array(await res.arrayBuffer());
    const header = new TextDecoder().decode(audio.subarray(0, 4));
    expect(header).toBe("RIFF");
    expect(audio.byteLength).toBeGreaterThan(44);
  });

  test("serves a KV cache hit without calling a provider again", async () => {
    const env = mockEnv();
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, geminiInlineResponse),
    );

    const first = await handleTts(
      makeRequest("Cached phrase", "fr"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("X-TTS-Cache")).toBe("MISS");

    const second = await handleTts(
      makeRequest("Cached phrase", "fr"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("X-TTS-Cache")).toBe("HIT");
    expect(second.headers.get("X-TTS-Provider")).toBe("gemini");
  });

  test("marks gemini down for the day on 429, then fails over to aura2", async () => {
    const env = mockEnv();
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, () => geminiError(429)),
    );

    // aura2 returns an MP3 via the AI binding (Deepgram Aura model).
    env.AI = {
      run: vi.fn(async (_model: string) => mp3Response()),
    } as unknown as typeof env.AI;

    const res = await handleTts(
      makeRequest("Hello", "en"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-TTS-Provider")).toBe("aura2");

    // gemini is flagged down for the UTC day.
    const today = new Date().toISOString().slice(0, 10);
    const flagged = await env.EKWE_KV.get(`tts:down:gemini:${today}`);
    expect(flagged).toBe("1");
  });

  test("skips a provider flagged down for the day", async () => {
    const env = mockEnv();
    const today = new Date().toISOString().slice(0, 10);
    await env.EKWE_KV.put(`tts:down:gemini:${today}`, "1");

    let geminiCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, () => {
        geminiCalls++;
        return geminiInlineResponse();
      }),
    );
    env.AI = {
      run: vi.fn(async (_model: string) => mp3Response()),
    } as unknown as typeof env.AI;

    const res = await handleTts(
      makeRequest("Hello", "en"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-TTS-Provider")).toBe("aura2");
    expect(geminiCalls).toBe(0);
  });

  test("falls back to melotts for a melotts-supported language when higher tiers fail", async () => {
    const env = mockEnv();
    env.AI = {
      run: vi.fn(async (model: string) => {
        if (model === MELOTTS_AI_MODEL) return mp3Response();
        throw new Error("aura unavailable");
      }),
    } as unknown as typeof env.AI;

    const res = await handleTts(
      makeRequest("Bonjour", "fr"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-TTS-Provider")).toBe("melotts");
  });

  test("returns 503 when no provider supports the language or all fail", async () => {
    const env = mockEnv();
    env.AI = {
      run: vi.fn(async () => {
        throw new Error("fail");
      }),
    } as unknown as typeof env.AI;

    // "de" is only supported by gemini, which fails here.
    const res = await handleTts(
      makeRequest("Hallo", "de"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("TTS_UNAVAILABLE");
  });

  test("does not mark the provider down on transient 5xx", async () => {
    const env = mockEnv();
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, () => geminiError(500)),
    );

    const res = await handleTts(
      makeRequest("Hello", "es"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(503);

    const today = new Date().toISOString().slice(0, 10);
    const flagged = await env.EKWE_KV.get(`tts:down:gemini:${today}`);
    expect(flagged).toBeNull();
  });

  test("retries a transient 5xx from the TTS preview model", async () => {
    const env = mockEnv();
    let geminiCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.geminiTtsGenerate, () => {
        geminiCalls++;
        return geminiCalls === 1 ? geminiError(500) : geminiInlineResponse();
      }),
    );

    const res = await handleTts(
      makeRequest("Hello", "es"),
      env,
      "PREMIUM",
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-TTS-Provider")).toBe("gemini");
    // Rotation fast-fails on 5xx after a single key, so the retry adds exactly
    // one request before the next attempt succeeds.
    expect(geminiCalls).toBe(2);
  });

  test(
    "rejects audio payloads over the hard byte cap",
    { timeout: 30_000 },
    async () => {
      const env = mockEnv();
      // PCM > 8 MB exceeds MAX_TTS_BYTES; pre-compute base64 outside the
      // handler so the MSW thread isn't blocked by String.fromCharCode spread.
      const hugePcmBase64 = bytesToBase64(
        new Uint8Array(9 * 1024 * 1024),
      );
      server.use(
        http.post(PROVIDER_URLS.geminiTtsGenerate, () => {
          return jsonResponse({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/L16;codec=pcm;rate=24000",
                        data: hugePcmBase64,
                      },
                    },
                  ],
                },
              },
            ],
          });
        }),
      );

      const res = await handleTts(
        makeRequest("Hello", "es"),
        env,
        "PREMIUM",
        new AbortController().signal,
      );
      expect(res.status).toBe(503);
    },
  );
});
