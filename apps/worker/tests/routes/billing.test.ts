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

// ─── Shared Flutterwave payment-link stub ─────────────────────────
function mockPaymentLink(body?: Record<string, unknown>): void {
  server.use(
    http.post("https://api.flutterwave.com/v3/payments", async ({ request }) => {
      if (body) Object.assign(body, await request.clone().json());
      return jsonResponse({
        status: "success",
        data: {
          link: "https://checkout.flutterwave.com/abc123",
          reference: "tx-ref-abc",
        },
      });
    }),
  );
}

// ─── Checkout Tests ───────────────────────────────────────────────

describe("handleCheckout", () => {
  beforeEach(() => {
    server.resetHandlers();
    resetPricingCache();
    resetFxCache();
  });

  test("returns checkout_url on successful Flutterwave initialization", async () => {
    mockPaymentLink();

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, string>;
    expect(data.checkout_url).toBe("https://checkout.flutterwave.com/abc123");
    expect(data.tx_ref).toBe("tx-ref-abc");
  });

  test("returns 400 for invalid plan ID", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "invalid_plan",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, string>;
    expect(data.error).toBe("INVALID_BODY");
  });

  test("returns 200 when redirect_url is omitted (worker supplies its own)", async () => {
    mockPaymentLink();
    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "ekwe_pro_monthly" }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
  });

  test("returns 503 when FLUTTERWAVE_SECRET is not configured", async () => {
    const env = mockEnv({});
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(503);
    const data = (await res.json()) as Record<string, string>;
    expect(data.error).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });

  test("returns 502 when Flutterwave API returns error", async () => {
    server.use(
      http.post("https://api.flutterwave.com/v3/payments", async () => {
        return jsonResponse({ status: "error", message: "Invalid amount" }, 400);
      }),
    );

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(502);
  });

  test("charges the annual USD amount from subscription_config", async () => {
    const body: Record<string, unknown> = {};
    mockPaymentLink(body);

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_annual",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    expect(body.amount).toBe(19.2); // $19.20 from subscription_config
    expect(body.currency).toBe("USD");
    // The charged amount/currency are echoed in meta for webhook verification.
    expect((body.meta as Record<string, unknown>).amount).toBe(19.2);
    expect((body.meta as Record<string, unknown>).currency).toBe("USD");
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.amount).toBe(19.2);
    expect(data.currency).toBe("USD");
  });

  test("charges the monthly USD amount from subscription_config", async () => {
    const body: Record<string, unknown> = {};
    mockPaymentLink(body);

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    expect(body.amount).toBe(2); // $2.00 from subscription_config
    expect(body.currency).toBe("USD");
  });

  test("prices the charge in a requested currency via FX", async () => {
    server.use(
      http.get(PROVIDER_URLS.openErApiLatest, () =>
        jsonResponse({ rates: { NGN: 1500 } }),
      ),
    );
    const body: Record<string, unknown> = {};
    mockPaymentLink(body);

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
        currency: "NGN",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(200);
    expect(body.amount).toBe(3000); // $2.00 × 1500
    expect(body.currency).toBe("NGN");
    expect((body.meta as Record<string, unknown>).amount).toBe(3000);
    expect((body.meta as Record<string, unknown>).currency).toBe("NGN");
  });

  test("returns 400 for an invalid currency code", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
        currency: "BANANA",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, string>;
    expect(data.error).toBe("INVALID_BODY");
  });

  test("sends correct tx_ref format with userId and plan", async () => {
    const body: Record<string, unknown> = {};
    mockPaymentLink(body);

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    await handleCheckout(req, env, mockAuth);
    expect(body.tx_ref).toBe("ekwe_test-user-123_monthly");
    expect((body.customer as Record<string, string>).email).toBe("test@example.com");
  });

  test("returns 400 for malformed JSON body", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid-json",
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(400);
  });

  test("returns 500 on network error", async () => {
    server.use(
      http.post("https://api.flutterwave.com/v3/payments", async () => {
        return Response.error();
      }),
    );

    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-secret-123" });
    const req = new Request("http://test/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "ekwe_pro_monthly",
        redirect_url: "https://app.ekwe.com/billing/callback",
      }),
    });

    const res = await handleCheckout(req, env, mockAuth);
    expect(res.status).toBe(500);
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
