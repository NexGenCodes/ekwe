import { describe, test, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";
import * as deepgram from "../../src/providers/deepgram";
import { handleTranscribe } from "../../src/routes/transcribe";
import { handleTranslate } from "../../src/routes/translate";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "../setup";

const blob = makeAudioBlob();
const signal = mockSignal();

function makeTranscribeRequest(lang = "en"): Request {
  const form = new FormData();
  form.append("file", blob, "test.wav");
  form.append("lang", lang);
  return new Request("http://test/transcribe", {
    method: "POST",
    body: form,
  });
}

function makeTranslateRequest(text = "Hello", sourceLang?: string): Request {
  const body: Record<string, string> = { text, targetLang: "es" };
  if (sourceLang) body.sourceLang = sourceLang;
  return new Request("http://test/translate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("provider error contracts", () => {
  test("deepgram: one bad key does not abort the request (401 -> next key succeeds)", async () => {
    const seen: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.deepgram, ({ request }) => {
        const auth = request.headers.get("Authorization") ?? "";
        seen.push(auth);
        if (auth === "Token mock-deepgram-1-abcde") {
          return new HttpResponse(null, { status: 401 });
        }
        return jsonResponse({
          results: { channels: [{ alternatives: [{ transcript: "recovered" }] }] },
          metadata: { duration: 1 },
        });
      }),
    );

    const result = await deepgram.transcribe(blob, "en", mockEnv(), signal);
    expect(result?.text).toBe("recovered");
    expect(seen).toContain("Token mock-deepgram-2-abcde");
  });

  test("deepgram: all keys rejected (401) returns null, route returns 503", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        new HttpResponse(null, { status: 401 }),
      ),
    );
    expect(await deepgram.transcribe(blob, "en", mockEnv(), signal)).toBeNull();

    const env = mockEnv({ AI: { run: vi.fn().mockRejectedValue(new Error("fail")) } } as any);
    const res = await handleTranscribe(
      makeTranscribeRequest(),
      env,
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(503);
  });

  test("deepgram: network error on every key returns null, route returns 503", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () => HttpResponse.error()),
    );
    expect(await deepgram.transcribe(blob, "en", mockEnv(), signal)).toBeNull();

    const env = mockEnv({ AI: { run: vi.fn().mockRejectedValue(new Error("fail")) } } as any);
    const res = await handleTranscribe(
      makeTranscribeRequest(),
      env,
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(503);
  });

  test("deepgram: 500 on all keys returns null", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        new HttpResponse("boom", { status: 500 }),
      ),
    );
    expect(await deepgram.transcribe(blob, "en", mockEnv(), signal)).toBeNull();
  });

  test("deepgram: malformed JSON body throws, route still returns 503 (no crash)", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        new HttpResponse("not-json{", { status: 200 }),
      ),
    );

    const env = mockEnv({ AI: { run: vi.fn().mockRejectedValue(new Error("fail")) } } as any);
    const res = await handleTranscribe(
      makeTranscribeRequest(),
      env,
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("ALL_PROVIDERS_FAILED");
  });

  test("translate: malformed provider JSON yields 503, not a crash", async () => {
    server.use(
      http.post(PROVIDER_URLS.groqChat, () =>
        new HttpResponse("not-json{", { status: 200 }),
      ),
    );

    const env = mockEnv({
      AI: { run: vi.fn().mockRejectedValue(new Error("fail")) },
    } as any);
    const res = await handleTranslate(
      makeTranslateRequest("Hello", "en"),
      env,
      "PREMIUM",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(503);
  });

  test("translate: empty provider transcript is not returned as a result", async () => {
    server.use(
      http.post(PROVIDER_URLS.groqChat, () =>
        jsonResponse({ choices: [{ message: { content: "" } }] }),
      ),
    );

    const env = mockEnv({
      AI: { run: vi.fn().mockRejectedValue(new Error("fail")) },
    } as any);
    const res = await handleTranslate(
      makeTranslateRequest("Hello", "en"),
      env,
      "FREE",
      new AbortController().signal,
      "test-user",
    );
    expect(res.status).toBe(503);
  });
});
