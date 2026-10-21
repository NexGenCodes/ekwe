import { describe, test, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import {
  handleCheckout,
  handleVerifyTransaction,
  handleBillingFlags,
} from "@/routes/billing";
import { resetPricingCache } from "@/routes/pricing";
import { jsonBody, mockDb, mockEnv } from "@/__tests__/setup";
import { server } from "@/__tests__/msw/server";

const FLUTTERWAVE_PAYMENTS_URL = "https://api.flutterwave.com/v3/payments";
const PAYMENT_LINK = "https://checkout.flutterwave.com/pay/test";

const liveEnv = (overrides: Parameters<typeof mockEnv>[0] = {}) =>
  mockEnv({ FLUTTERWAVE_SECRET: "FLWSECK-abc123", ...overrides });

const mockAuth = {
  userId: "test-user-123",
  userEmail: "test@example.com",
  tier: "FREE" as const,
  sessionId: "session-abc",
};

describe("handleCheckout", () => {
  beforeEach(() => {
    resetPricingCache();
    server.resetHandlers();
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

  const seedSubscriptionConfig = (
    localPrices: Record<string, { monthly: number; annual: number }> = {
      USD: { monthly: 2.23, annual: 21.41 },
      NGN: { monthly: 3000, annual: 28800 },
    },
  ) => {
    mockDb.where.mockResolvedValue([
      {
        id: 1,
        basePriceUsd: 2.23,
        discountPercent: 0,
        annualDiscountPercent: 20,
        localPrices: localPrices,
      },
    ]);
  };

  test("authorizes a checkout session with tx_ref, amount, and NGN default", async () => {
    seedSubscriptionConfig();
    const env = liveEnv();
    const res = await handleCheckout(monthlyBody(), env, mockAuth);

    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.tx_ref).toMatch(
      /^ekwe_test-user-123_monthly_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(data.amount).toBe(3000);
    expect(data.currency).toBe("NGN");
    expect(data).not.toHaveProperty("checkout_url");
  });

  test("fails closed when Supabase cannot confirm the price", async () => {
    mockDb.where.mockResolvedValue([]);
    const env = liveEnv();
    const res = await handleCheckout(monthlyBody(), env, mockAuth);
    expect(res.status).toBe(503);
  });

  test("charges the static annual USD amount when requested", async () => {
    seedSubscriptionConfig();
    const env = liveEnv();
    const res = await handleCheckout(
      { plan: "ekwe_pro_annual", currency: "USD" },
      env,
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.amount).toBe(21.41);
    expect(data.currency).toBe("USD");
  });

  test("charges the static monthly USD amount when requested", async () => {
    seedSubscriptionConfig();
    const env = liveEnv();
    const res = await handleCheckout(
      { plan: "ekwe_pro_monthly", currency: "USD" },
      env,
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.amount).toBe(2.23);
    expect(data.currency).toBe("USD");
  });

  test("charges the static local price in a requested currency", async () => {
    seedSubscriptionConfig();
    const env = liveEnv();
    const res = await handleCheckout(
      { plan: "ekwe_pro_monthly", currency: "NGN" },
      env,
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.amount).toBe(3000);
    expect(data.currency).toBe("NGN");
  });

  test("charges local_prices from the app_config row in Supabase", async () => {
    mockDb.where.mockResolvedValue([
      {
        id: 1,
        basePriceUsd: 2.5,
        discountPercent: 0,
        annualDiscountPercent: 20,
        localPrices: { NGN: { monthly: 4000, annual: 38400 } },
      },
    ]);

    const env = liveEnv();
    const res = await handleCheckout(
      { plan: "ekwe_pro_monthly", currency: "NGN" },
      env,
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.amount).toBe(4000);
    expect(data.currency).toBe("NGN");
  });

  test("falls back to NGN for unsupported currencies server-side", async () => {
    seedSubscriptionConfig();
    const env = liveEnv();
    const res = await handleCheckout(
      { plan: "ekwe_pro_monthly", currency: "BRL" },
      env,
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.amount).toBe(3000);
    expect(data.currency).toBe("NGN");
  });

  test("generates a unique tx_ref per checkout for the same user and plan", async () => {
    seedSubscriptionConfig();
    const env = liveEnv();

    const resA = await handleCheckout(monthlyBody(), env, mockAuth);
    const resB = await handleCheckout(monthlyBody(), env, mockAuth);
    const dataA = await jsonBody(resA);
    const dataB = await jsonBody(resB);

    expect(dataA.tx_ref).not.toBe(dataB.tx_ref);

    expect(dataA.tx_ref).toMatch(/^ekwe_test-user-123_/);
  });

  test("echoes the worker's public key and payment link", async () => {
    seedSubscriptionConfig();
    const res = await handleCheckout(
      monthlyBody(),
      liveEnv({ FLUTTERWAVE_PUBLIC: "FLWPUBK-abc123" }),
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.public_key).toBe("FLWPUBK-abc123");
    expect(data.link).toBe(PAYMENT_LINK);
  });

  test("fails when Flutterwave returns no payment link", async () => {
    seedSubscriptionConfig();
    server.use(
      http.post(FLUTTERWAVE_PAYMENTS_URL, () =>
        HttpResponse.json({ status: "success", data: {} }),
      ),
    );

    const res = await handleCheckout(monthlyBody(), liveEnv(), mockAuth);
    expect(res.status).toBe(502);
    const data = await jsonBody(res);
    expect(data.error).toBe("PAYMENT_INITIALIZATION_FAILED");
  });

  test("fails when Flutterwave is unreachable", async () => {
    seedSubscriptionConfig();
    server.use(
      http.post(FLUTTERWAVE_PAYMENTS_URL, () =>
        HttpResponse.json({ status: "error" }, { status: 500 }),
      ),
    );

    const res = await handleCheckout(monthlyBody(), liveEnv(), mockAuth);
    expect(res.status).toBe(502);
    const data = await jsonBody(res);
    expect(data.error).toBe("PAYMENT_INITIALIZATION_FAILED");
  });

  test("fails closed in production when a TEST secret key is configured", async () => {
    const res = await handleCheckout(
      monthlyBody(),
      mockEnv({
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
        FLUTTERWAVE_PUBLIC: "FLWPUBK_TEST-abc123",
      }),
      mockAuth,
    );
    expect(res.status).toBe(503);
    const data = await jsonBody(res);
    expect(data.error).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });

  test("fails closed in production when the secret or public key is missing", async () => {
    const missingSecret = await handleCheckout(
      monthlyBody(),
      mockEnv({ APP_ENV: "production", FLUTTERWAVE_PUBLIC: "FLWPUBK-abc123" }),
      mockAuth,
    );
    expect(missingSecret.status).toBe(503);

    const missingPublic = await handleCheckout(
      monthlyBody(),
      mockEnv({
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK-abc123",
      }),
      mockAuth,
    );
    expect(missingPublic.status).toBe(503);
  });

  test("fails when the Flutterwave secret is missing outside production", async () => {
    seedSubscriptionConfig();
    const res = await handleCheckout(monthlyBody(), mockEnv(), mockAuth);
    expect(res.status).toBe(503);
    const data = await jsonBody(res);
    expect(data.error).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });

  test("accepts TEST keys in non-production so the full flow is testable", async () => {
    seedSubscriptionConfig();
    const res = await handleCheckout(
      monthlyBody(),
      mockEnv({
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
  beforeEach(() => {
    server.resetHandlers();
  });

  test("fails closed in production with a TEST key (before contacting Flutterwave)", async () => {
    const res = await handleVerifyTransaction(
      { transaction_id: 288200108 },
      mockEnv({
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
      }),
      mockAuth,
    );
    expect(res.status).toBe(503);
    const data = await jsonBody(res);
    expect(data.error).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });
});

describe("handleBillingFlags", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  test("returns flags from payment_config table", async () => {
    mockDb.where.mockResolvedValue([
      {
        flutterwaveEnabled: true,
        defaultProvider: "flutterwave",
      },
    ]);

    const env = liveEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when payment_config table is empty", async () => {
    mockDb.where.mockResolvedValue([]);

    const env = liveEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when Supabase is unreachable", async () => {
    mockDb.where.mockRejectedValue(new Error("Supabase Unreachable"));

    const env = liveEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when Supabase returns 500", async () => {
    mockDb.where.mockRejectedValue(new Error("Internal Server Error"));

    const env = liveEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });
});
