import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { mockEnv, mockExecutionContext, jsonResponse } from "@/__tests__/setup";
import { checkPreflight } from "@/services/preflight";
import { fetchUsageSnapshot, trackBillableSuccess } from "@/services/usage";
import { handleVerifyTransaction } from "@/routes/billing";
import { resetPricingCache } from "@/routes/pricing";
import { getLimits } from "@/core/limits";

const MIGRATIONS_DIR = resolve(
  import.meta.dirname,
  "../../../../../supabase/migrations",
);

function readMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
}

function sqlParams(sql: string, name: string): string[] {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION\\s+public\\.${name}\\(([^)]*)\\)`,
    "i",
  );
  const m = sql.match(re);
  if (!m) throw new Error(`SQL signature not found for ${name}`);
  return m[1]
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0])
    .filter(Boolean);
}

const SEEDED_CONFIG = {
  id: 1,
  base_price_usd: 2.23,
  discount_percent: 0,
  annual_discount_percent: 20,
  local_prices: {
    USD: { monthly: 2.23, annual: 21.41 },
    NGN: { monthly: 3000, annual: 28800 },
    GHS: { monthly: 25, annual: 240 },
    KES: { monthly: 288, annual: 2765 },
    ZAR: { monthly: 36, annual: 346 },
    ZMW: { monthly: 41, annual: 394 },
    UGX: { monthly: 8200, annual: 78720 },
    TZS: { monthly: 5900, annual: 56640 },
    RWF: { monthly: 3260, annual: 31296 },
    XOF: { monthly: 1270, annual: 12192 },
    XAF: { monthly: 1270, annual: 12192 },
    GBP: { monthly: 1.65, annual: 15.84 },
    EUR: { monthly: 1.93, annual: 18.53 },
    CAD: { monthly: 3.09, annual: 29.66 },
  },
};

const CONTRACT_SQL = readMigration("20260923010000_add_stream_quota.sql");

function expectKeysAgainstSql(
  body: Record<string, unknown>,
  params: string[],
  fn: string,
) {
  expect(
    Object.keys(body).every((k) => params.includes(k)),
    `worker sends unknown RPC key for ${fn}: ${Object.keys(body)
      .filter((k) => !params.includes(k))
      .join(", ")}`,
  ).toBe(true);
}

describe("check_preflight ↔ worker payload", () => {
  const params = sqlParams(CONTRACT_SQL, "check_preflight");

  test("all ten params incl. p_premium_speech_chars_limit are the SQL-declared names", async () => {
    expect(params).toContain("p_user_id");
    expect(params).toContain("p_type");
    expect(params).toContain("p_premium_speech_chars_limit");
    expect(params).toContain("p_charge_chars");
  });

  test("worker checkPreflight('speech') sends only SQL-declared keys with a speech charge", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({
          allowed: true,
          tier_active: "PREMIUM",
          quota_total: 20000,
          quota_remaining: 19958,
        });
      }),
    );

    const res = await checkPreflight(
      mockEnv(),
      "contract-uid",
      "PREMIUM",
      "speech",
      null,
      42,
    );

    expect(res.allowed).toBe(true);
    expectKeysAgainstSql(body, params, "check_preflight");
    expect(body.p_type).toBe("speech");
    expect(body.p_premium_speech_chars_limit).toBe(
      getLimits("PREMIUM").dailySpeechCharsLimit,
    );
    expect(body.p_charge_chars).toBe(42);
  });

  test("translate/transcribe payloads send the same SQL-declared names with p_charge_chars 0", async () => {
    const types = ["translate", "transcribe"] as const;
    const bodies: Record<string, unknown>[] = [];
    for (const type of types) {
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
          bodies.push((await request.json()) as Record<string, unknown>);
          return jsonResponse({ allowed: true, tier_active: "FREE" });
        }),
      );
      await checkPreflight(mockEnv(), "contract-uid", "FREE", type, null);
    }

    for (const [i, type] of types.entries()) {
      expect(bodies[i].p_type).toBe(type);
      expect(bodies[i].p_charge_chars).toBe(0);
      expectKeysAgainstSql(bodies[i], params, "check_preflight");
    }
  });
});

describe("check_preflight SQL defaults vs plans.ts parity", () => {
  test("SQL parameter defaults match the source of truth in plans.ts", () => {
    const re =
      /CREATE OR REPLACE FUNCTION\s+public\.check_preflight\(([^)]*)\)/i;
    const match = CONTRACT_SQL.match(re);
    expect(match).not.toBeNull();

    const args = match![1].split(",").map((s) => s.trim());
    const defaults: Record<string, string> = {};
    for (const arg of args) {
      const parts = arg.split(/\s+/);
      const name = parts[0];
      const defaultIdx = parts.findIndex((p) => p.toUpperCase() === "DEFAULT");
      if (defaultIdx !== -1) {
        defaults[name] = parts
          .slice(defaultIdx + 1)
          .join(" ")
          .replace(/'/g, "");
      }
    }

    expect(defaults["p_free_cooldown_seconds"]).toBe(
      String(getLimits("FREE").cooldownSeconds),
    );
    expect(defaults["p_premium_cooldown_seconds"]).toBe(
      String(getLimits("PREMIUM").cooldownSeconds),
    );
    expect(defaults["p_premium_speech_chars_limit"]).toBe(
      String(getLimits("PREMIUM").dailySpeechCharsLimit),
    );
    // p_free_daily_limit is historically bound to translate's limit as the default
    expect(defaults["p_free_daily_limit"]).toBe(
      String(getLimits("FREE").dailyTranslateLimit),
    );
    // p_premium_throttle_threshold defaults to the translate throttle
    expect(defaults["p_premium_throttle_threshold"]).toBe(
      String(getLimits("PREMIUM").throttleTranslateThreshold),
    );
  });
});

describe("consume_usage ↔ worker payload", () => {
  const params = sqlParams(CONTRACT_SQL, "consume_usage");

  test("speech charges p_chars characters and names only SQL-declared keys", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseConsumeUsage, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ count: 500 });
      }),
    );

    const ctx = mockExecutionContext();
    trackBillableSuccess(mockEnv(), "contract-user", "speech", ctx, 458);
    await Promise.all(
      (ctx as unknown as { _waitUntilFns: Promise<unknown>[] })._waitUntilFns,
    );

    expect(body).toEqual({
      p_user_id: "contract-user",
      p_type: "speech",
      p_chars: 458,
    });
    expectKeysAgainstSql(body, params, "consume_usage");
  });

  test("non-speech types charge zero chars and keep the same SQL-declared names", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseConsumeUsage, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ count: 1 });
      }),
    );

    const ctx = mockExecutionContext();
    trackBillableSuccess(mockEnv(), "contract-user", "translate", ctx);
    await Promise.all(
      (ctx as unknown as { _waitUntilFns: Promise<unknown>[] })._waitUntilFns,
    );

    expect(body).toMatchObject({ p_type: "translate", p_chars: 0 });
    expectKeysAgainstSql(body, params, "consume_usage");
  });
});

describe("get_daily_usage ↔ worker payload", () => {
  const params = sqlParams(CONTRACT_SQL, "get_daily_usage");

  test("reads the speech key the RPC returns (prereq of the /usage meter)", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseGetDailyUsage, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({
          day: "2026-09-20",
          translate: 2,
          transcribe: 0,
          speech: 1743,
        });
      }),
    );

    const snap = await fetchUsageSnapshot(
      mockEnv(),
      "contract-user",
      "PREMIUM",
    );

    expect(body).toEqual({ p_user_id: "contract-user" });
    expectKeysAgainstSql(body, params, "get_daily_usage");
    expect(snap).not.toBeNull();
    expect(snap).toMatchObject({
      day: "2026-09-20",
      meters: [
        {
          id: "translate",
          used: 2,
          total: getLimits("PREMIUM").dailyTranslateLimit,
        },
        {
          id: "transcribe",
          used: 0,
          total: getLimits("PREMIUM").dailyTranscribeLimit,
        },
        {
          id: "speech",
          used: 1743,
          total: getLimits("PREMIUM").dailySpeechCharsLimit,
        },
      ],
    });
  });
});

describe("set_pro_status ↔ verify-transaction payload", () => {
  const sql = readMigration(
    "20260912020000_set_pro_status_with_payment_ref.sql",
  );
  const params = sqlParams(sql, "set_pro_status");

  test("grants a computed (non-permanent) expiry under SQL-declared key names", async () => {
    const userId = crypto.randomUUID();
    const env = mockEnv({ FLUTTERWAVE_SECRET: "FLWSECK-live-secret" });

    resetPricingCache();
    server.use(
      http.get(PROVIDER_URLS.supabaseAppConfig, () =>
        Response.json([SEEDED_CONFIG]),
      ),
    );

    server.use(
      http.get("https://api.flutterwave.com/v3/transactions/98765/verify", () =>
        jsonResponse({
          status: "success",
          message: "ok",
          data: {
            id: 98765,
            tx_ref: `ekwe_${userId}_monthly_${Date.now()}`,
            flw_ref: "flw-verify-ref",
            amount: 2.23,
            currency: "USD",
            status: "successful",
            created_at: new Date().toISOString(),
          },
        }),
      ),
    );

    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseSetProStatus, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ permanent: false });
      }),
    );

    const res = await handleVerifyTransaction(
      new Request("https://ekwe.test/billing/verify-transaction", {
        method: "POST",
        body: JSON.stringify({ transaction_id: 98765 }),
        headers: { "Content-Type": "application/json" },
      }),
      env,
      { userId, userEmail: "buyer@example.com" } as unknown as never,
    );

    expect(res.status).toBe(200);
    expectKeysAgainstSql(body, params, "set_pro_status");
    expect(body.p_is_pro).toBe(true);
    expect(body.p_provider).toBe("flutterwave");
    const expiresAt = String(body.p_expires_at);
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ms = Date.parse(expiresAt) - Date.now();
    expect(ms).toBeGreaterThan(29 * 86400000);
    expect(ms).toBeLessThan(31 * 86400000);
  });
});

describe("migration self-consistency (final quota contract)", () => {
  test("the final quota migration references speech_chars and stream_count, never tts_chars", () => {
    expect(CONTRACT_SQL).toContain("speech_chars");
    expect(CONTRACT_SQL).toContain("stream_count");
    expect(CONTRACT_SQL).not.toContain("p_premium_tts_chars_limit");
    expect(CONTRACT_SQL).toContain("p_premium_speech_chars_limit");
  });

  test("the stream quota migration drops then re-creates check_preflight with the same 10 args", () => {
    expect(CONTRACT_SQL).toContain("ADD COLUMN IF NOT EXISTS stream_count");
    expect(sqlParams(CONTRACT_SQL, "check_preflight")).toHaveLength(10);
    expect(sqlParams(CONTRACT_SQL, "consume_usage")).toEqual([
      "p_user_id",
      "p_type",
      "p_chars",
    ]);
  });

  test("the rename migrations still exist, in order", () => {
    const first = readMigration("20260920000000_rename_tts_to_speech.sql");
    const second = readMigration(
      "20260920010000_rename_tts_chars_column_to_speech_chars.sql",
    );
    expect(first).toContain("p_premium_speech_chars_limit");
    expect(second).toContain("speech_chars");
    expect(second).not.toContain("p_premium_tts_chars_limit");
  });
});
