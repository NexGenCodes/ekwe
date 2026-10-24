import { beforeEach, describe, expect, test } from "vitest";
import type { Env } from "@/core/types";
import { nextUtcMidnightMs, runPreflightGate } from "@/services/preflight";
import {
  FREE_LIMITS,
  WORKER_ERROR_CODES,
  utcDay,
  utcMonth,
} from "@ekwe/shared";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const FREE_TRANSLATE_CAP = FREE_LIMITS.dailyTranslateLimit ?? 0;

// In-memory KV for cooldown state (cdwn:<userId>).
function makeKvStore(): Map<string, string> {
  return new Map();
}

function makeEnv(database: TestDatabase, kvStore: Map<string, string>): Env {
  const kv = {
    get: async (key: string) => kvStore.get(key) ?? null,
    put: async (key: string, value: string) => void kvStore.set(key, value),
    delete: async (key: string) => void kvStore.delete(key),
  } as unknown as Env["EKWE_KV"];
  return { DB: database.d1, EKWE_KV: kv } as unknown as Env;
}

function makeCtx(): {
  ctx: { waitUntil: (promise: Promise<unknown>) => void };
  settled: () => Promise<void>;
} {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise) => void pending.push(promise) },
    settled: async () => {
      await Promise.allSettled(pending);
    },
  };
}

// Seeds the KV cooldown key with a past timestamp.
function seedCooldown(
  kvStore: Map<string, string>,
  lastRequestAt: number,
): void {
  kvStore.set(`cdwn:${USER_ID}`, String(lastRequestAt));
}

// Reads the recorded cooldown timestamp from KV.
function lastCooldownAt(kvStore: Map<string, string>): number | undefined {
  const val = kvStore.get(`cdwn:${USER_ID}`);
  return val !== undefined ? Number(val) : undefined;
}

function seedUsage(
  database: TestDatabase,
  counts: {
    translate?: number;
    transcribeMinutes?: number;
    speech?: number;
  },
): void {
  const transcribeMs = Math.round((counts.transcribeMinutes ?? 0) * 60_000);
  database.sqlite
    .prepare(
      `INSERT INTO user_daily_usage
         (user_id, day, translate_count, transcribe_count, transcribe_ms,
          speech_chars, stream_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      USER_ID,
      utcDay(Date.now()),
      counts.translate ?? 0,
      counts.transcribeMinutes ?? 0,
      transcribeMs,
      counts.speech ?? 0,
      Date.now(),
    );
}

function seedMonthlyUsage(
  database: TestDatabase,
  usage: {
    translate?: number;
    transcribeMinutes?: number;
    speech?: number;
    aiCredits?: number;
  },
): void {
  database.sqlite
    .prepare(
      `INSERT INTO user_monthly_usage
         (user_id, month, translate_count, transcribe_count, transcribe_ms,
          speech_chars, stream_count, stream_ms, ai_credits, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(
      USER_ID,
      utcMonth(Date.now()),
      usage.translate ?? 0,
      usage.transcribeMinutes ?? 0,
      Math.round((usage.transcribeMinutes ?? 0) * 60_000),
      usage.speech ?? 0,
      usage.aiCredits ?? 0,
      Date.now(),
    );
}

describe("runPreflightGate", () => {
  let database: TestDatabase;
  let env: Env;
  let kvStore: Map<string, string>;

  beforeEach(() => {
    database = createTestDatabase();
    kvStore = makeKvStore();
    env = makeEnv(database, kvStore);
  });

  test("allows the first request and records the cooldown", async () => {
    const { ctx, settled } = makeCtx();
    const before = Date.now();

    const result = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "translate",
    );
    await settled();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tier).toBe("FREE");
    expect(lastCooldownAt(kvStore)).toBeGreaterThanOrEqual(before);
  });

  test("denies a second request inside the FREE cooldown", async () => {
    const { ctx, settled } = makeCtx();
    await runPreflightGate(env, ctx, USER_ID, "FREE", "translate");

    const denied = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "translate",
    );
    await settled();

    expect(denied.ok).toBe(false);
    if (denied.ok) return;

    expect(denied.response.status).toBe(429);
    const retryAfter = Number(denied.response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3);

    const body = (await denied.response.json()) as { error: string };
    expect(body.error).toBe(WORKER_ERROR_CODES.EKWE_RATE_LIMIT);
  });

  test("allows again once the cooldown has elapsed", async () => {
    seedCooldown(kvStore, Date.now() - 5_000);

    const { ctx, settled } = makeCtx();
    const result = await runPreflightGate(env, ctx, USER_ID, "FREE", "speech");
    await settled();

    expect(result.ok).toBe(true);
  });

  test("premium has a shorter window than free", async () => {
    seedCooldown(kvStore, Date.now() - 1_500);

    const { ctx, settled } = makeCtx();
    const free = await runPreflightGate(env, ctx, USER_ID, "FREE", "translate");
    const premium = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "PREMIUM",
      "translate",
    );
    await settled();

    expect(free.ok).toBe(false);
    expect(premium.ok).toBe(true);
  });

  test("skips the cooldown when the request already charged one", async () => {
    const { ctx, settled } = makeCtx();
    await runPreflightGate(env, ctx, USER_ID, "FREE", "transcribe");
    const stamped = lastCooldownAt(kvStore);

    const skipped = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "translate",
      true,
    );
    await settled();

    expect(skipped.ok).toBe(true);
    expect(lastCooldownAt(kvStore)).toBe(stamped);
  });

  test("denies a FREE translation once the daily cap is reached", async () => {
    seedCooldown(kvStore, Date.now() - 5_000);
    seedUsage(database, { translate: FREE_TRANSLATE_CAP });

    const { ctx, settled } = makeCtx();
    const result = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "translate",
    );
    await settled();

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(429);
    expect(Number(result.response.headers.get("Retry-After"))).toBeGreaterThan(
      0,
    );
    const body = (await result.response.json()) as {
      error: string;
      quota_total: number;
      quota_remaining: number;
    };
    expect(body.error).toBe(WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED);
    expect(body.quota_total).toBe(FREE_TRANSLATE_CAP);
    expect(body.quota_remaining).toBe(0);
  });

  test("allows the last FREE translation below the cap", async () => {
    seedCooldown(kvStore, Date.now() - 5_000);
    seedUsage(database, { translate: FREE_TRANSLATE_CAP - 1 });

    const { ctx, settled } = makeCtx();
    const result = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "translate",
    );
    await settled();

    expect(result.ok).toBe(true);
  });

  test("speech charges the characters it is about to speak", async () => {
    seedCooldown(kvStore, Date.now() - 5_000);
    seedUsage(database, { speech: FREE_LIMITS.dailySpeechCharsLimit - 10 });

    const { ctx, settled } = makeCtx();
    const tooLong = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "speech",
      false,
      11,
    );
    await settled();

    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      const body = (await tooLong.response.json()) as { error: string };
      expect(body.error).toBe(WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED);
    }

    seedCooldown(kvStore, Date.now() - 5_000);
    const fits = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "speech",
      false,
      10,
    );
    await settled();

    expect(fits.ok).toBe(true);
  });

  test("denies every AI feature once the shared monthly budget is spent", async () => {
    seedCooldown(kvStore, Date.now() - 5_000);
    seedMonthlyUsage(database, {
      aiCredits: FREE_LIMITS.monthlyAiCreditsLimit,
    });

    const { ctx, settled } = makeCtx();
    const result = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "translate",
    );
    await settled();

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(429);
    const body = (await result.response.json()) as {
      error: string;
      quota_scope: string;
      quota_total: number;
      quota_remaining: number;
    };
    expect(body.error).toBe(WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED);
    expect(body.quota_scope).toBe("budget");
    expect(body.quota_total).toBe(FREE_LIMITS.monthlyAiCreditsLimit);
    expect(body.quota_remaining).toBe(0);
  });

  test("denies FREE transcription once the daily minute cap is reached", async () => {
    seedCooldown(kvStore, Date.now() - 5_000);
    seedUsage(database, {
      transcribeMinutes: FREE_LIMITS.dailyTranscribeMinutesLimit,
    });

    const { ctx, settled } = makeCtx();
    const result = await runPreflightGate(
      env,
      ctx,
      USER_ID,
      "FREE",
      "transcribe",
      false,
      0,
      1_000,
    );
    await settled();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    const body = (await result.response.json()) as {
      quota_scope: string;
      quota_total: number;
    };
    expect(body.quota_scope).toBe("daily");
    expect(body.quota_total).toBe(FREE_LIMITS.dailyTranscribeMinutesLimit);
  });

  test("fails closed when the quota read fails", async () => {
    const broken = {
      DB: {
        prepare() {
          throw new Error("D1 unavailable");
        },
      },
      EKWE_KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
    } as unknown as Env;

    const { ctx, settled } = makeCtx();
    const result = await runPreflightGate(
      broken,
      ctx,
      USER_ID,
      "FREE",
      "translate",
    );
    await settled();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toBe(WORKER_ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});

describe("nextUtcMidnightMs", () => {
  test("is the next UTC day boundary", () => {
    const next = nextUtcMidnightMs();
    expect(next).toBeGreaterThan(Date.now());
    expect(next % 86_400_000).toBe(0);
    expect(next - Date.now()).toBeLessThanOrEqual(86_400_000);
  });
});
