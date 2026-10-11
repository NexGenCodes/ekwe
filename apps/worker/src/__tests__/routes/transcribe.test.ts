import { describe, test, expect, vi } from "vitest";
import { handleTranscribe } from "@/routes/transcribe";
import {
  aiStub,
  jsonBody,
  jsonResponse,
  kvStub,
  makeAudioBlob,
  mockEnv,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

const MOCK_GLADIA_POLL = "https://mock.gladia/result";

function makeRequest(lang?: string): Request {
  const blob = makeAudioBlob();
  const form = new FormData();
  form.append("file", blob, "test.wav");
  form.append("duration", "1000");
  if (lang) form.append("lang", lang);
  return new Request("http://test/transcribe", {
    method: "POST",
    body: form,
  });
}

function makeDurationRequest(durationMs: number, lang?: string): Request {
  const blob = makeAudioBlob();
  const form = new FormData();
  form.append("file", blob, "test.wav");
  form.append("duration", String(durationMs));
  if (lang) form.append("lang", lang);
  return new Request("http://test/transcribe", {
    method: "POST",
    body: form,
  });
}

describe("handleTranscribe pipeline", () => {
  test("FREE pipeline returns result from first successful provider", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "wit result" });
      }),
    );

    const res = await handleTranscribe(
      makeRequest("en"),
      mockEnv(),
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    const body = await jsonBody(res);
    expect(body.text).toBe("wit result");
  });

  test("empty transcript from witai fails over to the next provider", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "", is_final: true });
      }),
      http.post(PROVIDER_URLS.groqTranscriptions, () =>
        jsonResponse({ text: "groq result" }),
      ),
    );

    const res = await handleTranscribe(
      makeRequest("en"),
      mockEnv(),
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    const body = await jsonBody(res);
    expect(body.text).toBe("groq result");
    expect(body.provider).toBe("groq");
    expect(calls).toHaveLength(1);
  });

  test("skipOnAuto skips witai when lang is auto", async () => {
    let witCalled = false;
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        witCalled = true;
        return jsonResponse({ text: "wit result" });
      }),
      http.post(PROVIDER_URLS.gladiaUpload, () =>
        jsonResponse({ audio_url: "https://mock.audio/url" }),
      ),
      http.post(PROVIDER_URLS.gladiaTranscription, () =>
        jsonResponse({ result_url: MOCK_GLADIA_POLL }),
      ),
      http.get(MOCK_GLADIA_POLL, () =>
        jsonResponse({
          status: "done",
          result: { transcription: { full_transcript: "gladia result" } },
        }),
      ),
    );

    const res = await handleTranscribe(
      makeRequest("auto"),
      mockEnv({
        GLADIA_KEY_2: "",
        GLADIA_KEY_3: "",
        GLADIA_KEY_4: "",
        GLADIA_KEY_5: "",
      }),
      "PREMIUM",
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    const body = await jsonBody(res);
    expect(witCalled).toBe(false);
    expect(body.text).toBe("gladia result");
  }, 15000);

  test("returns 400 when file is missing", async () => {
    const form = new FormData();
    form.append("lang", "en");
    const req = new Request("http://test/transcribe", {
      method: "POST",
      body: form,
    });
    const res = await handleTranscribe(
      req,
      mockEnv(),
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(400);
  });

  test("supportedLanguages skips cohere for unsupported language", async () => {
    let cohereCalled = false;
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () => {
        cohereCalled = true;
        return jsonResponse({ text: "cohere result" });
      }),
    );

    const env = mockEnv({
      AI: aiStub(async () => ({})),
    });

    const res = await handleTranscribe(
      makeRequest("ig"),
      env,
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(cohereCalled).toBe(false);
    expect(res.status).toBe(503);
  });

  test("supportedLanguages does not skip cohere for supported language", async () => {
    let cohereCalled = false;
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () => {
        cohereCalled = true;
        return jsonResponse({ text: "cohere result" });
      }),
    );

    const env = mockEnv({
      WIT_KEY_ES: "",
      AI: aiStub(async () => ({})),
    });

    const res = await handleTranscribe(
      makeRequest("es"),
      env,
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(cohereCalled).toBe(true);
    const body = await jsonBody(res);
    expect(body.text).toBe("cohere result");
  });

  test("returns 503 when all providers fail", async () => {
    const env = mockEnv({
      WIT_KEY_EN: "",
      AI: aiStub(vi.fn().mockRejectedValue(new Error("fail"))),
    });

    const res = await handleTranscribe(
      makeRequest("en"),
      env,
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(503);
  });

  test("returns 413 FILE_TOO_LARGE for oversized uploads (pre-guard)", async () => {
    const oversized = new Uint8Array(6 * 1024 * 1024);
    const req = new Request("http://test/transcribe", {
      method: "POST",
      body: oversized,
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
    });
    const res = await handleTranscribe(
      req,
      mockEnv(),
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(413);
    const body = await jsonBody(res);
    expect(body.error).toBe("FILE_TOO_LARGE");
  });

  test("returns 413 AUDIO_TOO_LONG when duration exceeds the plan limit", async () => {
    // The upload has to be big enough to actually hold the declared duration:
    // the guard cross-checks the declared duration against the byte size, so a
    // tiny file claiming 30 minutes is treated as a false declaration instead.
    const durationMs = 1_801_000;
    const blob = new Uint8Array(
      Math.ceil((4_000 * durationMs) / 8000 / 1024) * 1024,
    );
    const form = new FormData();
    form.append("file", new Blob([blob], { type: "audio/ogg" }), "long.ogg");
    form.append("duration", String(durationMs));

    const res = await handleTranscribe(
      new Request("http://test/transcribe", { method: "POST", body: form }),
      mockEnv(),
      "PREMIUM",
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(413);
    const body = await jsonBody(res);
    expect(body.error).toBe("AUDIO_TOO_LONG");
  });

  test("ignores a declared duration the upload cannot physically hold", async () => {
    // 30 minutes of speech cannot fit in a few KB. Honouring the declaration
    // would let a caller state any duration they liked, which is what the
    // duration guard exists to prevent.
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "wit result" }),
      ),
    );

    const res = await handleTranscribe(
      makeDurationRequest(1_801_000, "en"),
      mockEnv(),
      "PREMIUM",
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(200);
  });

  test("allows duration within the plan limit", async () => {
    let witCalled = false;
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        witCalled = true;
        return jsonResponse({ text: "wit result" });
      }),
    );

    const res = await handleTranscribe(
      makeDurationRequest(60_000, "en"),
      mockEnv(),
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(200);
    expect(witCalled).toBe(true);
  });

  test("returns 415 for non-multipart Content-Type", async () => {
    const req = new Request("http://test/transcribe", {
      method: "POST",
      body: JSON.stringify({ text: "not a multipart body" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleTranscribe(
      req,
      mockEnv(),
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(415);
    const body = await jsonBody(res);
    expect(body.error).toBe("INVALID_CONTENT_TYPE");
  });

  test("fails open to providers when KV cache lookup fails", async () => {
    const env = mockEnv({
      EKWE_KV: kvStub({
        get: async () => {
          throw new Error("kv down");
        },
        put: async () => {},
      }),
    });
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "wit result" }),
      ),
    );
    const res = await handleTranscribe(
      makeRequest("en"),
      env,
      "FREE",
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.text).toBe("wit result");
  });

  test("auto: accepts transcript whose detected language matches", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        jsonResponse({
          text: "deepgram auto result",
          metadata: { duration: 10.0 },
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript:
                      "This is a test of the automatic transcription system that converts speech into text",
                  },
                ],
                detected_language: "en",
              },
            ],
          },
        }),
      ),
    );

    const res = await handleTranscribe(
      makeRequest("auto"),
      mockEnv({
        AI: aiStub(vi.fn().mockRejectedValue(new Error("fail"))),
      }),
      "PREMIUM",
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.text).toContain("automatic transcription");
  });

  test("auto: rejects transcript whose detected language mismatches", async () => {
    let deepgramCalled = false;
    server.use(
      http.post(PROVIDER_URLS.deepgram, () => {
        deepgramCalled = true;
        return jsonResponse({
          text: "deepgram auto result",
          metadata: { duration: 10.0 },
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript:
                      "Bonjour mes amis, ceci est un test du système de transcription automatique qui fonctionne très bien",
                  },
                ],
                detected_language: "en",
              },
            ],
          },
        });
      }),
    );

    const res = await handleTranscribe(
      makeRequest("auto"),
      mockEnv({
        AI: aiStub(vi.fn().mockRejectedValue(new Error("fail"))),
      }),
      "PREMIUM",
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(deepgramCalled).toBe(true);
    expect(res.status).toBe(503);
  });

  test("PREMIUM pipeline tries witai (free) before paid providers for non-auto", async () => {
    const providerOrder: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        providerOrder.push("witai");
        return jsonResponse({ text: "wit result" });
      }),
      http.post(PROVIDER_URLS.deepgram, () => {
        providerOrder.push("deepgram");
        return jsonResponse({
          text: "deepgram result",
          metadata: { duration: 1.0 },
          results: {
            channels: [
              {
                alternatives: [{ transcript: "deepgram result" }],
                detected_language: "en",
              },
            ],
          },
        });
      }),
      http.post(PROVIDER_URLS.gladiaUpload, () => {
        providerOrder.push("gladia");
        return jsonResponse({ audio_url: "mock" });
      }),
      http.post(PROVIDER_URLS.gladiaTranscription, () =>
        jsonResponse({ result_url: "mock" }),
      ),
    );

    const res = await handleTranscribe(
      makeRequest("en"),
      mockEnv(),
      "PREMIUM",
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    const body = await jsonBody(res);
    expect(body.text).toBe("wit result");
    expect(providerOrder[0]).toBe("witai");
    expect(providerOrder).not.toContain("deepgram");
  });
});

function makeSizedRequest(totalBytes: number, lang?: string): Request {
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, totalBytes - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, totalBytes - 44, true);

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "test.wav");
  form.append("duration", "1000");
  if (lang) form.append("lang", lang);
  return new Request("http://test/transcribe", { method: "POST", body: form });
}

describe("throttled entitlement split", () => {
  const signal = () => new AbortController().signal;

  test("a throttled Pro keeps Pro size limits while running the FREE pipeline", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "wit result" }),
      ),
    );

    const throttled = await handleTranscribe(
      makeSizedRequest(6 * 1024 * 1024, "en"),
      mockEnv(),
      "PREMIUM",
      "FREE",
      signal(),
      "test-user",
    );
    expect(throttled.status).toBe(200);
    expect((await jsonBody(throttled)).text).toBe("wit result");
  });

  test("a throttled Pro keeps auto-detect while running the FREE pipeline", async () => {
    server.use(
      http.post(PROVIDER_URLS.groqTranscriptions, () =>
        jsonResponse({ text: "groq result" }),
      ),
    );

    const freeEntitled = await handleTranscribe(
      makeRequest("auto"),
      mockEnv(),
      "FREE",
      "FREE",
      signal(),
      "test-user",
    );
    expect(freeEntitled.status).toBe(403);
    expect((await jsonBody(freeEntitled)).error).toBe(
      "AUTO_DETECT_UNAVAILABLE",
    );

    const throttled = await handleTranscribe(
      makeRequest("auto"),
      mockEnv(),
      "PREMIUM",
      "FREE",
      signal(),
      "test-user",
    );
    expect(throttled.status).toBe(200);
    expect((await jsonBody(throttled)).provider).toBe("groq");
  });
});
