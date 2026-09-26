import { describe, test, expect, vi } from "vitest";

// Mocked so the test drives the real pipeline wiring without standing up a
// JWKS endpoint. Everything downstream of `authenticate` is the real code.
vi.mock("@/core/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/auth")>();
  return {
    ...actual,
    authenticate: vi.fn(async () => ({
      userId: "uid-pipe",
      userEmail: "p@example.com",
      tier: "PREMIUM" as const,
      sessionId: null,
    })),
  };
});

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));

import { runPipeline } from "@/core/pipeline";
// The real route table, so this test fails if the table ever stops forwarding
// `rctx.timings` into the synth handler.
import { routes } from "@/routes/table";
import {
  mockEnv,
  mockExecutionContext,
  jsonResponse,
  makeAudioBlob,
} from "@/__tests__/setup";
import { authenticate } from "@/core/auth";
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

function synthRequest(): Request {
  return new Request("http://test/synthesize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      text: "Hello there",
      sourceLang: "en",
      targetLang: "en",
    }),
  });
}

function setupProviders(): void {
  server.use(
    http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
      jsonResponse({
        allowed: true,
        tier_active: "PREMIUM",
        quota_total: 5000,
        quota_remaining: 5000,
      }),
    ),
    http.post(PROVIDER_URLS.geminiTtsGenerate, () => mp3Response()),
    http.post(PROVIDER_URLS.deepgramSpeak, () => mp3Response()),
    http.post(PROVIDER_URLS.witaiSynthesize, () => mp3Response()),
  );
}

function parseServerTiming(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean);
}

describe("Server-Timing wiring through runPipeline", () => {
  test("synth stage timings reach the pipeline's Server-Timing header", async () => {
    // Regression guard. `handleSynthesize` defaults `timings` to a fresh
    // RequestTimings, so a handler that forgets `rctx.timings` silently
    // discards every synth stage while the header still shows auth — the
    // instrumentation looks alive and reports nothing useful.
    setupProviders();

    const res = await runPipeline(
      synthRequest(),
      mockEnv(),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(200);
    const header = res.headers.get("Server-Timing");
    expect(header).toBeTruthy();

    const stages = parseServerTiming(header);
    expect(stages).toContain("auth");
    // The whole point of this instrumentation: the billable stages.
    expect(stages).toContain("tts");
    expect(stages).toContain("cache");
    expect(stages.some((s) => s.startsWith("total"))).toBe(true);
  });

  test("omits Server-Timing in production", async () => {
    setupProviders();

    const res = await runPipeline(
      synthRequest(),
      mockEnv({ APP_ENV: "production" }),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toBeNull();
  });

  test("a synth quota denial is still measured", async () => {
    // Synth runs its gate inside the handler rather than as a route preflight,
    // so the denial returns through the normal handler exit and must be
    // measured like any other response.
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

    const res = await runPipeline(
      synthRequest(),
      mockEnv(),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(429);
    const stages = parseServerTiming(res.headers.get("Server-Timing"));
    expect(stages).toContain("cache");
    expect(stages.some((s) => s.startsWith("total"))).toBe(true);
  });

  test("a route-level preflight denial reports the gate stage", async () => {
    // Transcribe gates at the pipeline level. This path used to return straight
    // from `runPipeline`, so the one request whose slowness you most need to
    // explain produced no timing and no latency sample at all.
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: false,
          reason: "QUOTA_EXCEEDED",
          tier_active: "PREMIUM",
          quota_total: 25,
          quota_remaining: 0,
        }),
      ),
    );

    const form = new FormData();
    form.append("file", makeAudioBlob(), "test.wav");

    const res = await runPipeline(
      new Request("http://test/transcribe", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: form,
      }),
      mockEnv(),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(429);
    const stages = parseServerTiming(res.headers.get("Server-Timing"));
    expect(stages).toContain("gate");
    expect(stages.some((s) => s.startsWith("total"))).toBe(true);
  });

  test("an invalid token reports the auth stage", async () => {
    // A *missing* token measures nothing, so it correctly carries no header.
    // A token that fails verification does spend time in `auth`.
    vi.mocked(authenticate).mockResolvedValueOnce(null);

    const res = await runPipeline(
      synthRequest(),
      mockEnv(),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(401);
    const stages = parseServerTiming(res.headers.get("Server-Timing"));
    expect(stages).toContain("auth");
  });

  test("a missing token carries no Server-Timing, having measured nothing", async () => {
    const res = await runPipeline(
      new Request("http://test/synthesize", { method: "POST" }),
      mockEnv(),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("Server-Timing")).toBeNull();
  });

  test("an unknown path is CORS-wrapped exactly once", async () => {
    // emit() now applies CORS, so the 404 must not end up wrapped twice.
    const res = await runPipeline(
      new Request("http://test/nope", {
        method: "POST",
        headers: { Origin: "http://localhost:8081" },
      }),
      mockEnv(),
      mockExecutionContext(),
      routes,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:8081",
    );
    // No Server-Timing: a 404 rejects before any stage is measured, and
    // `toServerTiming` stays silent rather than reporting a meaningless
    // `total;dur=0` on every unmatched path.
    expect(res.headers.get("Server-Timing")).toBeNull();
  });
});
