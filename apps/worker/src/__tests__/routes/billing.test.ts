import { beforeEach, describe, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import {
  handleCheckout,
  handleVerifyTransaction,
  handleBillingFlags,
} from "@/routes/billing";
import { resetPricingCache } from "@/routes/pricing";
import type { AuthResult } from "@/core/auth";
import type { Env } from "@/core/types";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";
import { jsonBody } from "@/__tests__/setup";
import { server } from "@/__tests__/msw/server";

const FLUTTERWAVE_PAYMENTS_URL = "https://api.flutterwave.com/v3/payments";
const FLUTTERWAVE_VERIFY_URL =
  "https://api.flutterwave.com/v3/transactions/:id/verify";
const PAYMENT_LINK = "https://checkout.flutterwave.com/pay/test";

const USER_ID = "3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";

const mockAuth: AuthResult = {
  userId: USER_ID,
  userEmail: "test@example.com",
  tier: "FREE",
  sessionId: "session-abc",
};

function makeEnv(
  database: TestDatabase,
  overrides: Record<string, unknown> = {},
): Env {
  return {
    DB: database.d1,
    APP_ENV: "test",
    FLUTTERWAVE_SECRET: "FLWSECK-abc123",
    FLUTTERWAVE_PUBLIC: "FLWPUBK-abc123",
    ...overrides,
  } as unknown as Env;
}

function seedUser(database: TestDatabase): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (id, email, email_norm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, mockAuth.userEmail, mockAuth.userEmail, now, now);
}

function seedConfig(
  database: TestDatabase,
  localPrices: Record<string, { monthly: number; annual: number }> = {
    USD: { monthly: 2.23, annual: 21.41 },
    NGN: { monthly: 3000, annual: 28800 },
  },
  basePriceUsd = 2.23,
): void {
  database.sqlite
    .prepare(
      `UPDATE app_config
          SET base_price_usd = ?, local_prices = ?, updated_at = ?
        WHERE id = 1`,
    )
    .run(basePriceUsd, JSON.stringify(localPrices), Date.now());
}

function subscription(database: TestDatabase) {
  return database.sqlite
    .prepare(
      `SELECT status, expires_at FROM user_subscriptions WHERE user_id = ?`,
    )
    .get(USER_ID) as { status: string; expires_at: number | null } | undefined;
}

function user(database: TestDatabase) {
  return database.sqlite
    .prepare("SELECT tier, pro_expires_at FROM users WHERE id = ?")
    .get(USER_ID) as { tier: string; pro_expires_at: number | null };
}

describe("handleCheckout", () => {
  let database: TestDatabase;

  beforeEach(() => {
    resetPricingCache();
    server.resetHandlers();
    database = createTestDatabase();
    seedUser(database);
    seedConfig(database);
    server.use(
      http.post(FLUTTERWAVE_PAYMENTS_URL, () =>
        HttpResponse.json({
          status: "success",
          data: { link: PAYMENT_LINK },
        }),
      ),
    );
  });

  const monthlyBody = () => ({ plan: "ekwe_pro_monthly" as const });

  test("authorizes a checkout session with tx_ref, amount, and NGN default", async () => {
    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.tx_ref).toMatch(
      /^ekwe_3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f_monthly_[0-9a-f-]{36}$/,
    );
    expect(data.amount).toBe(3000);
    expect(data.currency).toBe("NGN");
  });

  test("fails closed when app_config has no price for the currency", async () => {
    seedConfig(database, {});
    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database),
      mockAuth,
    );
    expect(res.status).toBe(503);
  });

  test("charges local_prices from app_config", async () => {
    seedConfig(database, { NGN: { monthly: 4000, annual: 38400 } }, 2.5);

    const res = await handleCheckout(
      { plan: "ekwe_pro_monthly", currency: "NGN" },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      amount: 4000,
      currency: "NGN",
    });
  });

  test("charges the billed currency for an annual plan", async () => {
    const res = await handleCheckout(
      { plan: "ekwe_pro_annual", currency: "USD" },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      amount: 21.41,
      currency: "USD",
    });
  });

  test("falls back to NGN for unsupported currencies", async () => {
    const res = await handleCheckout(
      { plan: "ekwe_pro_monthly", currency: "BRL" },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      amount: 3000,
      currency: "NGN",
    });
  });

  test("generates a unique tx_ref per checkout", async () => {
    const env = makeEnv(database);
    const first = await jsonBody(
      await handleCheckout(monthlyBody(), env, mockAuth),
    );
    const second = await jsonBody(
      await handleCheckout(monthlyBody(), env, mockAuth),
    );

    expect(first.tx_ref).not.toBe(second.tx_ref);
  });

  test("echoes the public key and payment link", async () => {
    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      public_key: "FLWPUBK-abc123",
      link: PAYMENT_LINK,
    });
  });

  test("fails when Flutterwave returns no payment link", async () => {
    server.use(
      http.post(FLUTTERWAVE_PAYMENTS_URL, () =>
        HttpResponse.json({ status: "success", data: {} }),
      ),
    );

    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toMatchObject({
      error: "PAYMENT_INITIALIZATION_FAILED",
    });
  });

  test("fails when Flutterwave errors", async () => {
    server.use(
      http.post(FLUTTERWAVE_PAYMENTS_URL, () =>
        HttpResponse.json({ status: "error" }, { status: 500 }),
      ),
    );

    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(502);
  });

  test("rejects TEST keys in production", async () => {
    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database, {
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
        FLUTTERWAVE_PUBLIC: "FLWPUBK_TEST-abc123",
      }),
      mockAuth,
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toMatchObject({
      error: "PAYMENT_PROVIDER_UNAVAILABLE",
    });
  });

  test("rejects a missing key in production", async () => {
    const missingSecret = await handleCheckout(
      monthlyBody(),
      makeEnv(database, {
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: undefined,
      }),
      mockAuth,
    );
    expect(missingSecret.status).toBe(503);

    const missingPublic = await handleCheckout(
      monthlyBody(),
      makeEnv(database, {
        APP_ENV: "production",
        FLUTTERWAVE_PUBLIC: undefined,
      }),
      mockAuth,
    );
    expect(missingPublic.status).toBe(503);
  });

  test("fails when the secret is missing outside production", async () => {
    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database, { FLUTTERWAVE_SECRET: undefined }),
      mockAuth,
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toMatchObject({
      error: "PAYMENT_PROVIDER_UNAVAILABLE",
    });
  });

  test("accepts TEST keys outside production", async () => {
    const res = await handleCheckout(
      monthlyBody(),
      makeEnv(database, {
        APP_ENV: "development",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
        FLUTTERWAVE_PUBLIC: "FLWPUBK_TEST-abc123",
      }),
      mockAuth,
    );

    expect(res.status).toBe(200);
  });
});

describe("handleVerifyTransaction", () => {
  let database: TestDatabase;

  const txRef = `ekwe_${USER_ID}_monthly_${crypto.randomUUID()}`;

  function serveVerification(
    overrides: Partial<{
      tx_ref: string;
      amount: number;
      currency: string;
      status: string;
      flw_ref: string;
      id: number;
    }> = {},
  ): void {
    const data = {
      id: 288200108,
      tx_ref: txRef,
      flw_ref: "FLW-REF-1",
      amount: 3000,
      currency: "NGN",
      status: "successful",
      ...overrides,
    };
    server.use(
      http.get(FLUTTERWAVE_VERIFY_URL, () =>
        HttpResponse.json({ status: "success", message: "ok", data }),
      ),
    );
  }

  beforeEach(() => {
    resetPricingCache();
    server.resetHandlers();
    database = createTestDatabase();
    seedUser(database);
    seedConfig(database);
  });

  test("rejects TEST keys in production before calling Flutterwave", async () => {
    const res = await handleVerifyTransaction(
      { transaction_id: 288200108 },
      makeEnv(database, {
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
      }),
      mockAuth,
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toMatchObject({
      error: "PAYMENT_PROVIDER_UNAVAILABLE",
    });
  });

  test("rejects a transaction owned by someone else", async () => {
    serveVerification({
      tx_ref: `ekwe_4a8d2e3f-6c7b-4d9e-8f01-2b3c4d5e6f70_monthly_${crypto.randomUUID()}`,
    });

    const res = await handleVerifyTransaction(
      { transaction_id: 288200108 },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(403);
  });

  test("rejects an amount that does not match the plan", async () => {
    serveVerification({ amount: 1 });

    const res = await handleVerifyTransaction(
      { transaction_id: 288200108 },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(400);
    expect(subscription(database)).toBeUndefined();
  });

  test("activates Paid and records the claim", async () => {
    serveVerification();
    const before = Date.now();

    const res = await handleVerifyTransaction(
      { transaction_id: 288200108 },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      ok: true,
      permanent: false,
      transaction_id: 288200108,
      tx_ref: txRef,
    });

    const updated = user(database);
    expect(updated.tier).toBe("PREMIUM");
    expect(updated.pro_expires_at).toBeGreaterThan(before + 29 * 86_400_000);

    expect(subscription(database)).toMatchObject({ status: "active" });
    const claim = database.sqlite
      .prepare("SELECT expires_at FROM flutterwave_claims WHERE flw_ref = ?")
      .get("FLW-REF-1") as { expires_at: number };
    expect(claim.expires_at).toBe(updated.pro_expires_at);
  });

  test("repairs an activation that failed after the claim", async () => {
    serveVerification();
    const expiry = Date.now() + 30 * 86_400_000;
    database.sqlite
      .prepare(
        `INSERT INTO flutterwave_claims
           (flw_ref, user_id, tx_ref, amount, currency, expires_at, claimed_at)
         VALUES ('FLW-REF-1', ?, ?, 3000, 'NGN', ?, ?)`,
      )
      .run(USER_ID, txRef, expiry, Date.now());

    const res = await handleVerifyTransaction(
      { transaction_id: 288200108 },
      makeEnv(database),
      mockAuth,
    );

    expect(res.status).toBe(200);
    expect(user(database)).toEqual({ tier: "PREMIUM", pro_expires_at: expiry });
  });

  test("a replayed flw_ref keeps the original expiry", async () => {
    serveVerification();
    const env = makeEnv(database);
    await handleVerifyTransaction({ transaction_id: 288200108 }, env, mockAuth);

    const firstExpiry = user(database).pro_expires_at;

    const replay = await handleVerifyTransaction(
      { transaction_id: 999 },
      env,
      mockAuth,
    );

    expect(replay.status).toBe(200);
    expect(user(database).pro_expires_at).toBe(firstExpiry);
  });
});

describe("handleBillingFlags", () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  const request = () =>
    new Request("http://test/billing/flags", { method: "GET" });

  test("returns the stored flags", async () => {
    database.sqlite
      .prepare(
        "UPDATE app_config SET flutterwave_enabled = 1, default_provider = 'flutterwave' WHERE id = 1",
      )
      .run();

    const res = await handleBillingFlags(request(), makeEnv(database));

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    });
  });

  test("returns defaults when app_config is empty", async () => {
    database.sqlite.prepare("DELETE FROM app_config WHERE id = 1").run();

    const res = await handleBillingFlags(request(), makeEnv(database));

    expect(await jsonBody(res)).toEqual({
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    });
  });

  test("returns defaults when the database is unreachable", async () => {
    const env = {
      DB: {
        prepare: () => {
          throw new Error("unreachable");
        },
      },
    } as unknown as Env;

    const res = await handleBillingFlags(request(), env);

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    });
  });
});
