import { describe, test, expect, beforeEach, vi } from "vitest";
import app from "@/index";
import { createWorker } from "@/worker";
import { mockEnv, jsonResponse } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));

import { jwtVerify } from "jose";

describe("Worker Router (index.ts)", () => {
  const env = mockEnv();

  beforeEach(() => {
    vi.restoreAllMocks();
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({ allowed: true, tier_active: "FREE" }),
      ),
      http.post(PROVIDER_URLS.supabaseConsumeUsage, () =>
        jsonResponse({ count: 1 }),
      ),
    );
  });

  describe("CORS & Preflight", () => {
    test("handles OPTIONS requests with CORS headers", async () => {
      const req = new Request("http://localhost/translate", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost" },
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost",
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
  });

  describe("Auth Middleware", () => {
    test("rejects request without Authorization header", async () => {
      const req = new Request("http://localhost/translate", {
        method: "POST",
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json).toHaveProperty("error", "UNAUTHORIZED");
    });

    test("accepts valid JWT and routes to handler", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "user-123",
          email: "test@example.com",
          app_metadata: { is_pro: false },
        },
      });

      // Cloudflare AI is the only provider this file leaves unmocked, so the
      // request reaches it. The pipeline now rejects an answer that is not in
      // the requested language, so the shared English placeholder would fail
      // the request instead of exercising the auth path it is here to test.
      const aiRun = env.AI.run;
      env.AI.run = (async (model: string) =>
        model === "@cf/zai-org/glm-4.7-flash"
          ? {
              choices: [
                {
                  index: 0,
                  message: {
                    content: "Bonjour, ceci est une traduction en français.",
                  },
                },
              ],
            }
          : {}) as unknown as typeof env.AI.run;

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify({
          text: "hello",
          sourceLang: "en",
          targetLang: "fr",
        }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);
      env.AI.run = aiRun;

      expect(res.status).toBe(200);
    });

    test("rejects request on /transcribe/stream with missing token", async () => {
      const req = new Request("http://localhost/transcribe/stream", {
        method: "GET",
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toBe("Missing token");
    });

    test("rejects request on /transcribe/stream with invalid token", async () => {
      (jwtVerify as any).mockRejectedValue(new Error("jwt malformed"));

      const req = new Request("http://localhost/transcribe/stream", {
        method: "GET",
        headers: { "Sec-WebSocket-Protocol": "bad-token" },
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toBe("Invalid token");
    });
  });

  describe("Daily usage quota", () => {
    test("returns 429 EKWE_QUOTA_EXCEEDED when the daily quota is exhausted", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "quota-user",
          email: "quota@example.com",
          app_metadata: { is_pro: false },
        },
      });
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
          jsonResponse({
            allowed: false,
            reason: "QUOTA_EXCEEDED",
            quota_total: 25,
            quota_remaining: 0,
          }),
        ),
      );

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify({ text: "hello", targetLang: "fr" }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
      const json = (await res.json()) as any;
      expect(json).toHaveProperty("error", "EKWE_QUOTA_EXCEEDED");
    });

    test("consumes quota on billable success but not on KV cache replays", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "replay-user",
          email: "replay@example.com",
          app_metadata: { is_pro: false },
        },
      });
      server.use(
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ choices: [{ message: { content: "Hola" } }] }),
        ),
      );

      const consumeCalls: string[] = [];
      server.use(
        http.post(PROVIDER_URLS.supabaseConsumeUsage, ({ request }) => {
          consumeCalls.push(request.url);
          return jsonResponse({ count: consumeCalls.length });
        }),
      );

      const mkReq = () =>
        new Request("http://localhost/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer replay-jwt",
          },
          body: JSON.stringify({
            text: "unique text cb9x",
            sourceLang: "en",
            targetLang: "es",
          }),
        });

      const waitUntil = vi.fn();

      const first = await app.fetch(mkReq(), env, {
        waitUntil,
        passThroughOnException: () => {},
      } as any);
      expect(first.status).toBe(200);
      await vi.waitFor(() => expect(consumeCalls.length).toBe(1));

      const second = await app.fetch(mkReq(), env, {
        waitUntil,
        passThroughOnException: () => {},
      } as any);
      expect(second.status).toBe(200);

      expect(consumeCalls.length).toBe(1);
    });

    test("serves a throttled PREMIUM request with FREE-tier limits instead of blocking", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "throttled-pro",
          email: "throttled@example.com",
          app_metadata: { is_pro: true },
        },
      });
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
          jsonResponse({
            allowed: true,
            tier_active: "PREMIUM",
            throttled: true,
            quota_total: 0,
            quota_remaining: 0,
          }),
        ),
      );

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify({
          text: "hello",
          targetLang: "fr",
          sourceLang: "auto",
        }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(403);
      const json = (await res.json()) as any;
      expect(json).toHaveProperty("error", "AUTO_DETECT_UNAVAILABLE");
    });

    test("honors the authoritative DB tier over a stale FREE JWT", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "db-pro-user",
          email: "dbpro@example.com",
          app_metadata: { is_pro: false },
        },
      });
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
          jsonResponse({
            allowed: true,
            tier_active: "PREMIUM",
            throttled: false,
            quota_total: 0,
            quota_remaining: 0,
          }),
        ),
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ choices: [{ message: { content: "Hola" } }] }),
        ),
      );

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer stale-free-jwt",
        },
        body: JSON.stringify({
          text: "hello",
          targetLang: "es",
          sourceLang: "auto",
        }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
    });

    test("downgrades a stale PREMIUM JWT to FREE when the DB says free", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "expired-pro",
          email: "expired@example.com",
          app_metadata: { is_pro: true },
        },
      });
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
          jsonResponse({
            allowed: true,
            tier_active: "FREE",
            throttled: false,
            quota_total: 25,
            quota_remaining: 24,
          }),
        ),
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ choices: [{ message: { content: "Bonjour" } }] }),
        ),
      );

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer stale-premium-jwt",
        },
        body: JSON.stringify({
          text: "hello",
          targetLang: "fr",
          sourceLang: "auto",
        }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(403);
      const json = (await res.json()) as any;
      expect(json).toHaveProperty("error", "AUTO_DETECT_UNAVAILABLE");
    });
  });

  describe("Route dispatch", () => {
    test("serves /health without auth", async () => {
      const req = new Request("http://localhost/health", { method: "GET" });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json).toHaveProperty("status", "ok");
      expect(json).toHaveProperty("degradedProviders");
      expect(json.degradedProviders).toEqual([]);
      expect(json.bindings).toEqual({ d1: "ok", kv: "ok" });
    });

    test("records a request-level analytics event for matched routes", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "metric-user",
          email: "metric@example.com",
          app_metadata: { is_pro: false },
        },
      });
      server.use(
        http.post(PROVIDER_URLS.supabaseGetDailyUsage, () =>
          jsonResponse({ day: "2026-08-13", translate: 2, transcribe: 0 }),
        ),
      );

      const res = await app.fetch(
        new Request("http://localhost/usage", {
          headers: { Authorization: "Bearer metric-jwt" },
        }),
        env,
        { waitUntil: vi.fn(), passThroughOnException: () => {} } as any,
      );
      expect(res.status).toBe(200);

      const calls = vi
        .mocked(env.EKWE_ANALYTICS!.writeDataPoint)
        .mock.calls.map(
          ([event]) =>
            event as {
              blobs?: (string | number | null)[];
              indexes?: string[];
            },
        );
      const requestEvent = calls.find(
        (event) => event?.blobs?.[1] === "request",
      );
      expect(requestEvent).toBeDefined();
      expect(requestEvent!.indexes).toEqual(["/usage:/usage"]);
      expect(requestEvent!.blobs?.[4]).toBe("FREE");
      expect(requestEvent!.blobs?.[10]).toBe("200");
    });

    test("returns 404 for an unknown path without requiring auth or running preflight", async () => {
      let preflightCalls = 0;
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () => {
          preflightCalls += 1;
          return jsonResponse({ allowed: true, tier_active: "FREE" });
        }),
      );

      const res = await app.fetch(
        new Request("http://localhost/does-not-exist", { method: "GET" }),
        env,
        { waitUntil: vi.fn(), passThroughOnException: () => {} } as any,
      );

      expect(res.status).toBe(404);
      const json = (await res.json()) as any;
      expect(json).toHaveProperty("error", "NOT_FOUND");
      expect(preflightCalls).toBe(0);
    });

    test("returns 404 when the HTTP method does not match a known route", async () => {
      const res = await app.fetch(
        new Request("http://localhost/translate", { method: "GET" }),
        env,
        { waitUntil: vi.fn(), passThroughOnException: () => {} } as any,
      );

      expect(res.status).toBe(404);
    });

    test("GET /usage returns a snapshot without running the preflight gate", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "usage-user",
          email: "usage@example.com",
          app_metadata: { is_pro: false },
        },
      });

      let preflightCalls = 0;
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () => {
          preflightCalls += 1;

          return jsonResponse({ allowed: false, reason: "QUOTA_EXCEEDED" });
        }),
        http.post(PROVIDER_URLS.supabaseGetDailyUsage, () =>
          jsonResponse({ day: "2026-08-13", translate: 2, transcribe: 0 }),
        ),
      );

      const req = new Request("http://localhost/usage", {
        method: "GET",
        headers: { Authorization: "Bearer usage-jwt" },
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
      expect(preflightCalls).toBe(0);
      const json = (await res.json()) as any;
      expect(json).toMatchObject({ day: "2026-08-13" });
    });
  });

  describe("Queue handler", () => {
    test("acks DLQ messages after reporting them to Sentry", async () => {
      const ack = vi.fn();
      const batch = {
        queue: "ekwe-maintenance-dlq",
        messages: [
          {
            id: "dlq-1",
            timestamp: new Date(0),
            attempts: 5,
            body: { type: "cleanup_expired_history" },
            ack,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>;

      await createWorker().queue(batch, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext);

      expect(ack).toHaveBeenCalledTimes(1);
      expect((batch as any).retryAll).not.toHaveBeenCalled();
    });

    test("does not ack maintenance tasks dispatched on the main queue", async () => {
      const ack = vi.fn();
      const batch = {
        queue: "ekwe-maintenance",
        messages: [
          { id: "m-1", timestamp: new Date(0), attempts: 1, body: null, ack },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>;

      await createWorker().queue(batch, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext);

      expect(ack).not.toHaveBeenCalled();
    });
  });
});
