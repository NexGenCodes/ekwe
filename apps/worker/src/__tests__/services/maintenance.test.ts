import { beforeEach, describe, expect, test } from "vitest";
import type { Env } from "@/core/types";
import {
  cleanupAuthState,
  cleanupBillingClaims,
  cleanupDailyUsage,
  cleanupSyncState,
  purgeTombstones,
} from "@/services/maintenance";
import { fetchUsageSnapshot } from "@/services/usage";
import { utcDay, utcMonth } from "@ekwe/shared";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const DAY_MS = 86_400_000;

function makeEnv(database: TestDatabase): Env {
  return { DB: database.d1 } as unknown as Env;
}

function seedUser(database: TestDatabase): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (id, email, email_norm, tier, created_at, updated_at)
       VALUES (?, ?, ?, 'FREE', ?, ?)`,
    )
    .run(USER_ID, "maint@test.dev", "maint@test.dev", now, now);
}

function count(database: TestDatabase, table: string): number {
  const row = database.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as { n: number };
  return row.n;
}

describe("maintenance retention", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    database = createTestDatabase();
    env = makeEnv(database);
    seedUser(database);
  });

  test("prunes expired and revoked auth state, keeping live sessions", async () => {
    const now = Date.now();
    const insertSession = database.sqlite.prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_used_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertRotation = database.sqlite.prepare(
      `INSERT INTO session_rotations (refresh_hash, session_id, issued_at)
       VALUES (?, ?, ?)`,
    );

    insertSession.run("live", USER_ID, now, now, now + DAY_MS, null);
    insertRotation.run("live-fresh", "live", now);
    insertRotation.run("live-old", "live", now - 40 * DAY_MS);
    insertSession.run("expired", USER_ID, now, now, now - 1, null);
    insertRotation.run("expired-fresh", "expired", now);
    insertSession.run("revoked", USER_ID, now, now, now + DAY_MS, now);
    insertRotation.run("revoked-fresh", "revoked", now);

    database.sqlite
      .prepare(
        `INSERT INTO otp_codes (email_norm, code_hash, expires_at, last_sent_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("old@test.dev", "hash", now - 2 * DAY_MS, now - 2 * DAY_MS);
    database.sqlite
      .prepare(
        `INSERT INTO otp_codes (email_norm, code_hash, expires_at, last_sent_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("new@test.dev", "hash", now + 300_000, now);

    const removed = await cleanupAuthState(env);
    expect(removed).toBeGreaterThanOrEqual(5);
    expect(count(database, "sessions")).toBe(1);
    expect(count(database, "session_rotations")).toBe(1);
    expect(count(database, "otp_codes")).toBe(1);

    const liveRotation = database.sqlite
      .prepare("SELECT refresh_hash FROM session_rotations")
      .get() as { refresh_hash: string };
    expect(liveRotation.refresh_hash).toBe("live-fresh");
  });

  test("keeps a week of daily usage", async () => {
    const today = utcDay(Date.now());
    const sevenDaysAgo = utcDay(Date.now() - 7 * DAY_MS);
    const eightDaysAgo = utcDay(Date.now() - 8 * DAY_MS);
    const insert = database.sqlite.prepare(
      `INSERT INTO user_daily_usage
         (user_id, day, translate_count, transcribe_count, speech_chars, stream_count, updated_at)
       VALUES (?, ?, 0, 0, 0, 0, ?)`,
    );
    insert.run(USER_ID, today, Date.now());
    insert.run(USER_ID, sevenDaysAgo, Date.now());
    insert.run(USER_ID, eightDaysAgo, Date.now());

    await cleanupDailyUsage(env);

    const days = database.sqlite
      .prepare("SELECT day FROM user_daily_usage ORDER BY day")
      .all() as Array<{ day: string }>;
    expect(days.map((row) => row.day)).toEqual([sevenDaysAgo, today]);
  });

  test("prunes billing claims only after the retention window", async () => {
    const now = Date.now();
    const insert = database.sqlite.prepare(
      `INSERT INTO flutterwave_claims
         (flw_ref, user_id, tx_ref, amount, currency, expires_at, claimed_at)
       VALUES (?, ?, ?, 1, 'NGN', ?, ?)`,
    );
    insert.run("old", USER_ID, "tx-old", now - 91 * DAY_MS, now);
    insert.run("recent", USER_ID, "tx-recent", now - DAY_MS, now);

    await cleanupBillingClaims(env);

    const rows = database.sqlite
      .prepare("SELECT flw_ref FROM flutterwave_claims")
      .all() as Array<{ flw_ref: string }>;
    expect(rows.map((row) => row.flw_ref)).toEqual(["recent"]);
  });

  test("prunes stale inactive push tokens", async () => {
    const now = Date.now();
    const stale = now - 31 * DAY_MS;

    const insertToken = database.sqlite.prepare(
      `INSERT INTO push_tokens
         (id, user_id, push_token, platform, is_active, last_used_at, created_at)
       VALUES (?, ?, ?, 'android', ?, ?, ?)`,
    );
    insertToken.run("stale-inactive", USER_ID, "tok-1", 0, stale, stale);
    insertToken.run("fresh-inactive", USER_ID, "tok-2", 0, now, now);
    insertToken.run("stale-active", USER_ID, "tok-3", 1, stale, stale);

    await cleanupSyncState(env);

    const tokens = database.sqlite
      .prepare("SELECT id FROM push_tokens ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(tokens.map((row) => row.id)).toEqual([
      "fresh-inactive",
      "stale-active",
    ]);
  });

  test("purges old tombstones only", async () => {
    const now = Date.now();
    const insert = database.sqlite.prepare(
      `INSERT INTO history
         (id, user_id, source_lang, target_lang, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'en', 'ig', ?, ?, ?)`,
    );
    insert.run("old", USER_ID, now, now, now - 40 * DAY_MS);
    insert.run("recent", USER_ID, now, now, now - DAY_MS);

    await purgeTombstones(env);

    const rows = database.sqlite
      .prepare("SELECT id FROM history")
      .all() as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toEqual(["recent"]);
  });
});

describe("fetchUsageSnapshot", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    database = createTestDatabase();
    env = makeEnv(database);
    seedUser(database);
  });

  test("reports daily numeric caps and remaining for FREE", async () => {
    const snapshot = await fetchUsageSnapshot(env, USER_ID, "FREE");
    expect(snapshot).not.toBeNull();
    const translate = snapshot!.meters.find((m) => m.id === "translate");
    const transcribe = snapshot!.meters.find((m) => m.id === "transcribe");
    const stream = snapshot!.meters.find((m) => m.id === "stream");

    expect(translate).toMatchObject({ total: 20, remaining: 20, used: 0 });
    expect(transcribe).toMatchObject({ total: 10, remaining: 10, used: 0 });
    expect(stream).toMatchObject({ total: 0, remaining: 0, used: 0 });
  });

  test("reports monthly PREMIUM usage", async () => {
    database.sqlite
      .prepare(
        `INSERT INTO user_monthly_usage
           (user_id, month, translate_count, transcribe_count, transcribe_ms,
            speech_chars, stream_count, stream_ms, ai_credits, updated_at)
         VALUES (?, ?, 100, 3, 180000, 900, 4, 240000, 350, ?)`,
      )
      .run(USER_ID, utcMonth(Date.now()), Date.now());

    const snapshot = await fetchUsageSnapshot(env, USER_ID, "PREMIUM");
    expect(snapshot).not.toBeNull();
    const translate = snapshot!.meters.find((m) => m.id === "translate");
    const transcribe = snapshot!.meters.find((m) => m.id === "transcribe");
    const speech = snapshot!.meters.find((m) => m.id === "speech");
    const stream = snapshot!.meters.find((m) => m.id === "stream");

    expect(translate).toMatchObject({
      total: 600,
      remaining: 500,
      used: 100,
    });
    expect(transcribe).toMatchObject({ total: 300, remaining: 297, used: 3 });
    expect(speech).toMatchObject({ total: 50_000, remaining: 49_100 });
    expect(stream).toMatchObject({ total: 60, remaining: 56, used: 4 });
  });
});
