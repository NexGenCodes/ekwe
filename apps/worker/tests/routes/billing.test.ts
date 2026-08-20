import { describe, test, expect, beforeEach } from "vitest";
import { handleCheckout, handleBillingFlags } from "../../src/routes/billing";
import { resetPricingCache } from "../../src/routes/pricing";
import { resetFxCache } from "../../src/services/money";
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
    server.resetHandlers();
    resetPricingCache();
    resetFxCache();
  });

  const monthlyRequest = () =>
    new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "ekwe_pro_monthly" }),
    });

  test("authorizes a checkout session with tx_ref, amount, and currency", async () => {
    const env = mockEnv();
    const res = await handleCheckout(monthlyRequest(), env, mockAuth);

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.tx_ref).toMatch(/^ekwe_test-user-123_monthly_\d+_[a-z0-9]+$/);
    expect(data.amount).toBe(2); // $2.00 from subscription_config
    expect(data.currency).toBe("USD");
    expect(data).not.toHaveProperty("checkout_url");
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
    const data = (await res.json()) as Record<string, string>;
    expect(data.error).toBe("INVALID_BODY");
  });

  test("charges the annual USD amount from subscription_config", async () => {
    const env = mockEnv();
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "ekwe_pro_annual" }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.amount).toBe(19.2); // $19.20 from subscription_config
    expect(data.currency).toBe("USD");
  });

  test("charges the monthly USD amount from subscription_config", async () => {
    const env = mockEnv();
    const res = await handleCheckout(monthlyRequest(), env, mockAuth);

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.amount).toBe(2); // $2.00 from subscription_config
    expect(data.currency).toBe("USD");
  });

  test("prices the charge in a requested currency via FX", async () => {
    server.use(
      http.get(PROVIDER_URLS.openErApiLatest, () =>
        jsonResponse({ rates: { NGN: 1500 } }),
      ),
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
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.amount).toBe(3000); // $2.00 × 1500
    expect(data.currency).toBe("NGN");
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
    const data = (await res.json()) as Record<string, string>;
    expect(data.error).toBe("INVALID_BODY");
  });

  test("generates a unique tx_ref per checkout for the same user and plan", async () => {
    const env = mockEnv();

    const resA = await handleCheckout(monthlyRequest(), env, mockAuth);
    const resB = await handleCheckout(monthlyRequest(), env, mockAuth);
    const dataA = (await resA.json()) as { tx_ref: string };
    const dataB = (await resB.json()) as { tx_ref: string };

    expect(dataA.tx_ref).not.toBe(dataB.tx_ref);
    // The webhook's resolveUser parses the `ekwe_<userId>_` prefix.
    expect(dataA.tx_ref).toMatch(/^ekwe_test-user-123_/);
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
    const data = (await res.json()) as Record<string, unknown>;
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
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });

  test("returns defaults when Supabase is unreachable", async () => {
    // No handler registered for paymentConfig → MSW returns 404 → falls back to defaults
    const env = mockEnv();
    const req = new Request("http://test/billing/flags", { method: "GET" });
    const res = await handleBillingFlags(req, env);

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
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
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.flutterwave_enabled).toBe(true);
    expect(data.default_provider).toBe("flutterwave");
  });
});
