import { beforeEach, describe, expect, test, vi } from "vitest";
import { FREE_LIMITS } from "@ekwe/shared";
import app from "@/index";
import { createWorker } from "@/worker";
import {
  jsonBody,
  jsonResponse,
  mockEnv,
  mockExecutionContext,
} from "@/__tests__/setup";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import type { Env, Tier } from "@/core/types";

vi.mock("@/core/auth", () => ({
  authenticate: vi.fn(),
  isAdminAuthorized: vi.fn(async () => true),
}));

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: () => [],
}));

import { authenticate } from "@/core/auth";

const USER_ID = "3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const DAY_MS = 86_400_000;

function mockAuth(userId: string, tier: Tier = "FREE"): void {
  vi.mocked(authenticate).mockResolvedValue({
    userId,
    userEmail: "test@example.com",
    tier,
    sessionId: null,
  });
}

function makeEnv(
  database: TestDatabase,
  overrides: Record<string, unknown> = {},
): Env {
  return {
    ...mockEnv(),
    DB: database.d1,
    APP_ENV: "test",
    ...overrides,
  } as unknown as Env;
}

function translateRequest(): Request {
  return new Request("http://localhost/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-jwt",
    },
    body: JSON.stringify({
      text: "hello",
      sourceLang: "en",
      targetLang: "es",
    }),
  });
}

function seedCooldown(
  database: TestDatabase,
  userId: string,
  lastRequestAt: number,
): void {
  database.sqlite
    .prepare(
      `INSERT INTO user_cooldowns (user_id, last_request_at, updated_at)
       VALUES (?, ?, ?)`,
    )
    .run(userId, lastRequestAt, lastRequestAt);
}

describe("Worker router", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    server.resetHandlers();
    database = createTestDatabase();
    env = makeEnv(database);
  });

  describe("CORS and auth", () => {
    test("answers preflight with CORS headers", async () => {
      const res = await app.fetch(
        new Request("http://localhost/translate", {
          method: "OPTIONS",
          headers: { Origin: "http://localhost" },
        }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost",
      );
    });

    test("rejects a request without a token", async () => {
      const res = await app.fetch(
        new Request("http://localhost/translate", { method: "POST" }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(401);
      expect(await jsonBody(res)).toHaveProperty("error", "UNAUTHORIZED");
    });

    test("rejects a stream without a token", async () => {
      const res = await app.fetch(
        new Request("http://localhost/transcribe/stream", { method: "GET" }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(401);
      expect(await res.text()).toBe("Missing token");
    });

    test("rejects a stream with an invalid token", async () => {
      vi.mocked(authenticate).mockResolvedValue(null);

      const res = await app.fetch(
        new Request("http://localhost/transcribe/stream", {
          method: "GET",
          headers: { "Sec-WebSocket-Protocol": "bad-token" },
        }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(401);
      expect(await res.text()).toBe("Invalid token");
    });
  });

  describe("cooldown gate", () => {
    test("returns 429 while the FREE window is open", async () => {
      mockAuth(USER_ID, "FREE");
      seedCooldown(database, USER_ID, Date.now());

      const res = await app.fetch(
        translateRequest(),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
      expect(await jsonBody(res)).toHaveProperty("error", "EKWE_RATE_LIMIT");
    });

    test("lets a request through after the window closes", async () => {
      mockAuth(USER_ID, "FREE");
      seedCooldown(database, USER_ID, Date.now() - 4_000);
      server.use(
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ choices: [{ message: { content: "Hola" } }] }),
        ),
      );

      const res = await app.fetch(
        translateRequest(),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(200);
    });

    test("uses the PREMIUM window from the token", async () => {
      mockAuth(USER_ID, "FREE");
      seedCooldown(database, USER_ID, Date.now() - 1_500);

      const free = await app.fetch(
        translateRequest(),
        env,
        mockExecutionContext(),
      );
      expect(free.status).toBe(429);

      const premiumUser = "4a8d2e3f-6c7b-4d9e-8f01-2b3c4d5e6f70";
      mockAuth(premiumUser, "PREMIUM");
      seedCooldown(database, premiumUser, Date.now() - 1_500);
      server.use(
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ choices: [{ message: { content: "Hola" } }] }),
        ),
        http.post(PROVIDER_URLS.mistralChat, () =>
          jsonResponse({ choices: [{ message: { content: "Hola" } }] }),
        ),
      );

      const premium = await app.fetch(
        translateRequest(),
        env,
        mockExecutionContext(),
      );
      expect(premium.status).toBe(200);
    });
  });

  describe("route dispatch", () => {
    test("serves /health without auth", async () => {
      const res = await app.fetch(
        new Request("http://localhost/health", { method: "GET" }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toMatchObject({
        status: "ok",
        degradedProviders: [],
        bindings: { d1: "ok", kv: "ok" },
      });
    });

    test("serves /usage without running the cooldown gate", async () => {
      mockAuth(USER_ID, "FREE");
      seedCooldown(database, USER_ID, Date.now());

      const res = await app.fetch(
        new Request("http://localhost/usage", {
          headers: { Authorization: "Bearer valid-jwt" },
        }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body).toMatchObject({
        day: new Date().toISOString().slice(0, 10),
        month: new Date().toISOString().slice(0, 7),
      });
      expect(body.meters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "translate",
            used: 0,
            total: FREE_LIMITS.monthlyTranslateLimit,
            remaining: FREE_LIMITS.monthlyTranslateLimit,
          }),
          expect.objectContaining({
            id: "transcribe",
            used: 0,
            total: FREE_LIMITS.monthlyTranscribeMinutesLimit,
            remaining: FREE_LIMITS.monthlyTranscribeMinutesLimit,
          }),
          expect.objectContaining({
            id: "speech",
            used: 0,
            total: FREE_LIMITS.monthlySpeechCharsLimit,
            remaining: FREE_LIMITS.monthlySpeechCharsLimit,
          }),
          expect.objectContaining({
            id: "budget",
            used: 0,
            total: FREE_LIMITS.monthlyAiCreditsLimit,
            remaining: FREE_LIMITS.monthlyAiCreditsLimit,
          }),
        ]),
      );
    });

    test("returns 404 for an unknown path", async () => {
      const res = await app.fetch(
        new Request("http://localhost/does-not-exist", { method: "GET" }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(404);
      expect(await jsonBody(res)).toHaveProperty("error", "NOT_FOUND");
    });

    test("returns 404 when the method does not match", async () => {
      const res = await app.fetch(
        new Request("http://localhost/translate", { method: "GET" }),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(404);
    });

    test("serves /config with the Free push cap", async () => {
      const res = await app.fetch(
        new Request("http://localhost/config"),
        env,
        mockExecutionContext(),
      );

      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toMatchObject({
        syncPullRows: 200,
        syncPushRows: 25,
        maxHistoryBatchBytes: 90 * 1024,
      });
    });

    test("serves /config with the Paid push cap", async () => {
      const res = await app.fetch(
        new Request("http://localhost/config"),
        makeEnv(database, { WORKERS_PAID: "true" }),
        mockExecutionContext(),
      );

      expect(await jsonBody(res)).toMatchObject({ syncPushRows: 200 });
    });
  });

  describe("scheduled maintenance", () => {
    test("prunes expired history and old tombstones", async () => {
      const now = Date.now();

      database.sqlite
        .prepare(
          `INSERT INTO users (id, email, email_norm, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(USER_ID, "paid@test.dev", "paid@test.dev", now, now);

      database.sqlite
        .prepare(
          `INSERT INTO user_subscriptions
             (user_id, status, platform, expires_at, created_at, updated_at)
           VALUES (?, 'active', 'web', ?, ?, ?)`,
        )
        .run(USER_ID, now + 10 * DAY_MS, now, now);

      const insertHistory = database.sqlite.prepare(
        `INSERT INTO history
           (id, user_id, source_lang, target_lang, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'en', 'fr', ?, ?, ?)`,
      );
      insertHistory.run("free-old", "free-user", now - 20 * DAY_MS, now, null);
      insertHistory.run("paid-old", USER_ID, now - 20 * DAY_MS, now, null);
      insertHistory.run(
        "tombstone-old",
        "free-user",
        now - 60 * DAY_MS,
        now,
        now - 40 * DAY_MS,
      );
      insertHistory.run(
        "tombstone-recent",
        "free-user",
        now - 60 * DAY_MS,
        now,
        now - 5 * DAY_MS,
      );

      const ctx = mockExecutionContext() as unknown as ExecutionContext & {
        _waitUntilFns: Promise<unknown>[];
      };
      createWorker().scheduled({} as ScheduledController, env, ctx);
      await Promise.all(ctx._waitUntilFns);

      const ids = (
        database.sqlite.prepare("SELECT id FROM history ORDER BY id").all() as {
          id: string;
        }[]
      ).map((row) => row.id);

      expect(ids).toEqual(["paid-old", "tombstone-recent"]);
    });

    test("keeps an active Paid row for the full Paid window", async () => {
      const now = Date.now();

      database.sqlite
        .prepare(
          `INSERT INTO users (id, email, email_norm, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(USER_ID, "paid@test.dev", "paid@test.dev", now, now);
      database.sqlite
        .prepare(
          `INSERT INTO user_subscriptions
             (user_id, status, platform, expires_at, created_at, updated_at)
           VALUES (?, 'active', 'web', ?, ?, ?)`,
        )
        .run(USER_ID, now + 10 * DAY_MS, now, now);

      database.sqlite
        .prepare(
          `INSERT INTO history
             (id, user_id, source_lang, target_lang, created_at, updated_at)
           VALUES ('paid-25d', ?, 'en', 'fr', ?, ?)`,
        )
        .run(USER_ID, now - 25 * DAY_MS, now);

      const ctx = mockExecutionContext() as unknown as ExecutionContext & {
        _waitUntilFns: Promise<unknown>[];
      };
      createWorker().scheduled({} as ScheduledController, env, ctx);
      await Promise.all(ctx._waitUntilFns);

      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS n FROM history WHERE id = 'paid-25d'")
          .get(),
      ).toEqual({ n: 1 });
    });
  });
});
