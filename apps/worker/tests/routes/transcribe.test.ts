import { describe, test, expect, vi } from "vitest";
import { handleTranscribe } from "../../src/routes/transcribe";
import { mockEnv, makeAudioBlob, jsonResponse } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

const MOCK_GLADIA_POLL = "https://mock.gladia/result";

function makeRequest(lang?: string): Request {
  const blob = makeAudioBlob();
  const form = new FormData();
  form.append("file", blob, "test.wav");
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
      new AbortController().signal,
      "test-user",
    );
    const body = (await res.json()) as { text?: string };
    expect(body.text).toBe("wit result");
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
      } as any),
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    const body = (await res.json()) as { text?: string };
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
      AI: {
        run: async () => {
          return {};
        },
      },
    } as any);

    const res = await handleTranscribe(
      makeRequest("ig"), // not in cohere's supportedLanguages
      env,
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
      WIT_KEY_ES: "", // witai skipped - no key for Spanish
      AI: {
        run: async () => {
          return {};
        },
      },
    } as any);

    const res = await handleTranscribe(
      makeRequest("es"), // in cohere's supportedLanguages
      env,
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(cohereCalled).toBe(true);
    const body = (await res.json()) as { text?: string };
    expect(body.text).toBe("cohere result");
  });

  test("returns 503 when all providers fail", async () => {
    const env = mockEnv({
      WIT_KEY_EN: "", // witai skipped - no key
      AI: { run: vi.fn().mockRejectedValue(new Error("fail")) },
    } as any);

    const res = await handleTranscribe(
      makeRequest("en"),
      env,
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
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("FILE_TOO_LARGE");
  });

  test("returns 413 AUDIO_TOO_LONG when duration exceeds the plan limit", async () => {
    const res = await handleTranscribe(
      makeDurationRequest(1_801_000, "en"),
      mockEnv(),
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("AUDIO_TOO_LONG");
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
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("INVALID_CONTENT_TYPE");
  });

  test("fails open to providers when KV cache lookup fails", async () => {
    const env = mockEnv({
      EKWE_KV: {
        get: async () => {
          throw new Error("kv down");
        },
        put: async () => {},
      },
    } as any);
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "wit result" }),
      ),
    );
    const res = await handleTranscribe(
      makeRequest("en"),
      env,
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text?: string };
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
        AI: { run: vi.fn().mockRejectedValue(new Error("fail")) },
      } as any),
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text?: string };
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
        AI: { run: vi.fn().mockRejectedValue(new Error("fail")) },
      } as any),
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(deepgramCalled).toBe(true);
    expect(res.status).toBe(503);
  });

  test("PREMIUM pipeline uses different provider order", async () => {
    const providerOrder: string[] = [];
    server.use(
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
      new AbortController().signal,
      "test-user",
    );
    const body = (await res.json()) as { text?: string };
    expect(body.text).toContain("deepgram");
    expect(providerOrder[0]).toBe("deepgram");
  });
});
