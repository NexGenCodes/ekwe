import { describe, test, expect, beforeEach } from "vitest";
import {
  handleCheckout,
  handleVerifyTransaction,
  handleBillingFlags,
} from "../../routes/billing";
import { resetPricingCache } from "../../routes/pricing";
import { mockEnv, jsonResponse } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

// ─── Shared mock auth ─────────────────────────────────────────────
const mockAuth = {
  userId: "test-user-123",
  userEmail: "test@example.com",
  tier: "FREE" as const,
  sessionId: "session-abc",
};

// ─── Checkout Tests ───────────────────────────────────────────────

describe("handleCheckout", () => {
  beforeEach(() => {
    resetPricingCache();
    server.resetHandlers();
  });

  const monthlyRequest = () =>
    new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "ekwe_pro_monthly" }),
    });

  // Checkout prices are read authoritatively from the Supabase
  // app_config row (matching the verify-transaction grant path). The
  // seeded default matches the bundled LOCAL_PRICES so these tests assert the
  // familiar amounts.
  const seedSubscriptionConfig = (
    localPrices: Record<string, { monthly: number; annual: number }> = {
      USD: { monthly: 2.23, annual: 21.41 },
      NGN: { monthly: 3000, annual: 28800 },
    },
  ) => {
    server.use(
      http.get(PROVIDER_URLS.supabaseAppConfig, () => {
        return Response.json([
          {
            id: 1,
            base_price_usd: 2.23,
            discount_percent: 0,
            annual_discount_percent: 20,
            local_prices: localPrices,
          },
        ]);
      }),
    );
  };

  test("authorizes a checkout session with tx_ref, amount, and currency", async () => {
    seedSubscriptionConfig();
    const env = mockEnv();
    const res = await handleCheckout(monthlyRequest(), env, mockAuth);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tx_ref).toMatch(/^ekwe_test-user-123_monthly_\d+_[a-z0-9]+$/);
    expect(data.amount).toBe(2.23); // $2.23/mo from subscription_config
    expect(data.currency).toBe("USD");
    expect(data).not.toHaveProperty("checkout_url");
  });

  test("fails closed when Supabase cannot confirm the price", async () => {
    // No subscription_config handler → getAuthoritativePlanPrices returns
    // null, so checkout must 503 rather than mint a price that the grant
    // path would later reject.
    const env = mockEnv();
    const res = await handleCheckout(monthlyRequest(), env, mockAuth);
    expect(res.status).toBe(503);
  });

  test("returns 400 for invalid plan ID", async () => {
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "invalid_plan" }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toBe("INVALID_BODY");
  });

  test("charges the static annual USD amount", async () => {
    seedSubscriptionConfig();
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "ekwe_pro_annual" }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.amount).toBe(21.41); // $21.41/yr from subscription_config
    expect(data.currency).toBe("USD");
  });

  test("charges the static monthly USD amount", async () => {
    seedSubscriptionConfig();
    const env = mockEnv();
    const res = await handleCheckout(monthlyRequest(), env, mockAuth);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.amount).toBe(2.23); // $2.23/mo from subscription_config
    expect(data.currency).toBe("USD");
  });

  test("charges the static local price in a requested currency", async () => {
    seedSubscriptionConfig();
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        currency: "NGN",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.amount).toBe(3000); // static ₦3,000/mo from subscription_config
    expect(data.currency).toBe("NGN");
  });

  test("charges local_prices from the app_config row in Supabase", async () => {
    server.use(
      http.get(PROVIDER_URLS.supabaseAppConfig, () => {
        return Response.json([
          {
            id: 1,
            base_price_usd: 2.5,
            discount_percent: 0,
            annual_discount_percent: 20,
            local_prices: { NGN: { monthly: 4000, annual: 38400 } },
          },
        ]);
      }),
    );

    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        currency: "NGN",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.amount).toBe(4000);
    expect(data.currency).toBe("NGN");
  });

  test("resolves unsupported currencies to USD server-side", async () => {
    seedSubscriptionConfig();
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        currency: "BRL",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.amount).toBe(2.23);
    expect(data.currency).toBe("USD");
  });

  test("returns 400 for an invalid currency code", async () => {
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        currency: "BANANA",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toBe("INVALID_BODY");
  });

  test("generates a unique tx_ref per checkout for the same user and plan", async () => {
    seedSubscriptionConfig();
    const env = mockEnv();

    const resA = await handleCheckout(monthlyRequest(), env, mockAuth);
    const resB = await handleCheckout(monthlyRequest(), env, mockAuth);
    const dataA = (await resA.json()) as any;
    const dataB = (await resB.json()) as any;

    expect(dataA.tx_ref).not.toBe(dataB.tx_ref);
    // The webhook's resolveUser parses the `ekwe_<userId>_` prefix.
    expect(dataA.tx_ref).toMatch(/^ekwe_test-user-123_/);
  });

  test("echoes the worker's public key in the checkout session", async () => {
    seedSubscriptionConfig();
    const res = await handleCheckout(
      monthlyRequest(),
      mockEnv({ FLUTTERWAVE_PUBLIC: "FLWPUBK-abc123" }),
      mockAuth,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.public_key).toBe("FLWPUBK-abc123");
  });

  test("fails closed in production when a TEST secret key is configured", async () => {
    const res = await handleCheckout(
      monthlyRequest(),
      mockEnv({
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
        FLUTTERWAVE_PUBLIC: "FLWPUBK_TEST-abc123",
      }),
      mockAuth,
    );
    expect(res.status).toBe(503);
    const data = (await res.json()) as any;
    expect(data.error).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });

  test("fails closed in production when the secret or public key is missing", async () => {
    const missingSecret = await handleCheckout(
      monthlyRequest(),
      mockEnv({ APP_ENV: "production", FLUTTERWAVE_PUBLIC: "FLWPUBK-abc123" }),
      mockAuth,
    );
    expect(missingSecret.status).toBe(503);

    const missingPublic = await handleCheckout(
      monthlyRequest(),
      mockEnv({
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK-abc123",
      }),
      mockAuth,
    );
    expect(missingPublic.status).toBe(503);
  });

  test("accepts TEST keys in non-production so the full flow is testable", async () => {
    seedSubscriptionConfig();
    const res = await handleCheckout(
      monthlyRequest(),
      mockEnv({
        APP_ENV: "development",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
        FLUTTERWAVE_PUBLIC: "FLWPUBK_TEST-abc123",
      }),
      mockAuth,
    );
    expect(res.status).toBe(200);
  });

  test("returns 400 for malformed JSON body", async () => {
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid-json",
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(400);
  });
});

// ─── Verify Transaction Tests ─────────────────────────────────────

describe("handleVerifyTransaction", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  const verifyRequest = () =>
    new Request("http://test/billing/verify-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: 288200108 }),
    });

  test("fails closed in production with a TEST key (before contacting Flutterwave)", async () => {
    const res = await handleVerifyTransaction(
      verifyRequest(),
      mockEnv({
        APP_ENV: "production",
        FLUTTERWAVE_SECRET: "FLWSECK_TEST-abc123",
      }),
      mockAuth,
    );
    expect(res.status).toBe(503);
    const data = (await res.json()) as any;
    expect(data.error).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });

  test("rejects a non-numeric transaction_id", async () => {
    const req = new Request("http://test/billing/verify-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: "abc" }),
    });
    const res = await handleVerifyTransaction(req, mockEnv({}), mockAuth);
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toBe("INVALID_BODY");
  });
});

// ─── Billing Flags Tests ──────────────────────────────────────────

describe("handleBillingFlags", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  test("returns flags from payment_config table", async () => {
    server.use(
      http.get(PROVIDER_URLS.supabasePaymentConfig, () => {
        return jsonResponse([
          {
            flutterwave_enabled: true,
            default_provider: "flutterwave",
          },
        ]);
      }),
    );

    const env = mockEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when payment_config table is empty", async () => {
    server.use(
      http.get(PROVIDER_URLS.supabasePaymentConfig, () => {
        return jsonResponse([]);
      }),
    );

    const env = mockEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when Supabase is unreachable", async () => {
    // No handler registered for paymentConfig → MSW returns 404 → falls back to defaults
    const env = mockEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when Supabase returns 500", async () => {
    server.use(
      http.get(PROVIDER_URLS.supabasePaymentConfig, () => {
        return jsonResponse({ error: "Internal Server Error" }, 500);
      }),
    );

    const env = mockEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });
});
