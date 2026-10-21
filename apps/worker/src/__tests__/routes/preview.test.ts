import { describe, test, expect, vi } from "vitest";

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));

import { synthesizeVoicePreview } from "@/routes/preview";
import {
  executeQueryToSql,
  jsonBody,
  jsonResponse,
  mockDb,
  mockEnv,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { RequestTimings } from "@/core/timing";
import { SYNTHESIZE_TOTAL_MS } from "@/core/budgets";
import type { Env } from "@/core/types";

function mp3Response(): Response {
  return new Response(new Uint8Array(4_096), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

function previewEnv(deepgramCalls: { count: number }): Env {
  server.use(
    http.post(PROVIDER_URLS.geminiTtsGenerate, () =>
      jsonResponse({ error: { code: 429, message: "throttled" } }, 429),
    ),
    http.post(PROVIDER_URLS.deepgramSpeak, () => {
      deepgramCalls.count++;
      return mp3Response();
    }),
  );
  return mockEnv();
}

interface GateCounts {
  preflight: number;
  consume: number;
}

let counts: GateCounts = { preflight: 0, consume: 0 };

function trackGates(): void {
  counts = { preflight: 0, consume: 0 };
  mockDb.execute.mockImplementation(async (query) => {
    const queryStr = executeQueryToSql(query);
    if (queryStr.includes("check_preflight")) counts.preflight++;
    if (queryStr.includes("consume_usage")) counts.consume++;
    const { defaultMockDbExecute } = await import("@/__tests__/setup");
    return defaultMockDbExecute(query);
  });
}

function gateCounts(): GateCounts {
  return counts;
}

function preview(
  body: Record<string, unknown>,
  env: Env,
  userId = "uid-preview",
): Promise<Response> {
  const start = Date.now();
  return synthesizeVoicePreview(
    body as never,
    env,
    new AbortController().signal,
    userId,
    () => SYNTHESIZE_TOTAL_MS - (Date.now() - start),
    new RequestTimings(),
  );
}

describe("synthesizeVoicePreview", () => {
  test("serves a pro-voice preview to a free user without a gate or charge", async () => {
    trackGates();
    const deepgramCalls = { count: 0 };
    const env = previewEnv(deepgramCalls);

    const res = await preview(
      { voiceId: "studio", gender: "female", lang: "en" },
      env,
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.voiceId).toBe("studio");
    expect(body.translated).toBe(false);
    expect(body.sourceLang).toBe("en");
    expect(body.targetLang).toBe("en");
    expect(deepgramCalls.count).toBe(1);
    expect(gateCounts().preflight).toBe(0);
    expect(gateCounts().consume).toBe(0);
  });

  test("reuses the shared clip for a second user instead of re-synthesizing", async () => {
    trackGates();
    const deepgramCalls = { count: 0 };
    const env = previewEnv(deepgramCalls);

    const first = await preview(
      { voiceId: "studio", gender: "male", lang: "en" },
      env,
      "uid-a",
    );
    expect(first.status).toBe(200);
    expect(deepgramCalls.count).toBe(1);

    const second = await preview(
      { voiceId: "studio", gender: "male", lang: "en" },
      env,
      "uid-b",
    );
    expect(second.status).toBe(200);
    expect(deepgramCalls.count).toBe(1);
  });

  test("returns 503 when every speech provider fails", async () => {
    trackGates();
    const env = mockEnv();

    const res = await preview(
      { voiceId: "standard", gender: "female", lang: "en" },
      env,
    );
    expect(res.status).toBe(503);
    expect((await jsonBody(res)).error).toBe("SPEECH_UNAVAILABLE");
  });
});
