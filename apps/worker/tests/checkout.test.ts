import { describe, test, expect } from "vitest";
import {
  handlePricing,
  handleCheckoutInitialize,
} from "../src/routes/checkout";
import { mockEnv, jsonResponse } from "./setup";
import { http } from "msw";
import { server } from "./msw/server";
import { PROVIDER_URLS } from "./msw/handlers";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/checkout/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handlePricing", () => {
  test("falls back to FALLBACK_RATES when FX is unavailable", async () => {
    server.use(
      http.get(PROVIDER_URLS.frankfurterLatest, () => jsonResponse({}, 500)),
    );
    const res = await handlePricing(mockEnv());
    const json = (await res.json()) as {
      pricing: Record<string, Record<string, { amount: number; lowestUnit: number }>>;
    };

    expect(json.pricing.USD.monthly).toEqual({
      amount: 3,
      currency: "USD",
      lowestUnit: 300,
    });
    expect(json.pricing.NGN.monthly).toEqual({
      amount: 3000,
      currency: "NGN",
      lowestUnit: 300000,
    });
    // XOF uses 0 decimals
    expect(json.pricing.XOF.monthly).toEqual({
      amount: 1800,
      currency: "XOF",
      lowestUnit: 1800,
    });
    expect(json.pricing.NGN.annual.lowestUnit).toBe(2880000);
  });

  test("uses cached FX rates from KV", async () => {
    const env = mockEnv();
    await env.EKWE_KV.put(
      "fx:USD",
      JSON.stringify({ rates: { NGN: 500 }, ts: Date.now() }),
    );

    const res = await handlePricing(env);
    const json = (await res.json()) as {
      pricing: Record<string, Record<string, { amount: number; lowestUnit: number }>>;
    };

    expect(json.pricing.NGN.monthly).toEqual({
      amount: 1500,
      currency: "NGN",
      lowestUnit: 150000,
    });
  });
});

describe("handleCheckoutInitialize", () => {
  test("returns 400 for malformed JSON", async () => {
    const res = await handleCheckoutInitialize(
      jsonRequest("{nope"),
      mockEnv(),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "INVALID_JSON" }),
    );
  });

  test("returns 400 when plan_id or currency is missing", async () => {
    const res = await handleCheckoutInitialize(
      jsonRequest({}),
      mockEnv(),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "BAD_REQUEST" }),
    );
  });

  test("returns 400 for unsupported currencies", async () => {
    const res = await handleCheckoutInitialize(
      jsonRequest({ plan_id: "pro_monthly", currency: "JPY" }),
      mockEnv(),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "INVALID_CURRENCY" }),
    );
  });

  test("returns 400 for unknown plans", async () => {
    const res = await handleCheckoutInitialize(
      jsonRequest({ plan_id: "pro_weekly", currency: "NGN" }),
      mockEnv(),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "INVALID_PLAN" }),
    );
  });

  test("returns 500 when Paystack is not configured", async () => {
    const res = await handleCheckoutInitialize(
      jsonRequest({ plan_id: "pro_monthly", currency: "NGN" }),
      mockEnv(),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "SERVER_ERROR" }),
    );
  });

  test("initializes a Paystack transaction", async () => {
    let paystackBody: string | undefined;
    server.use(
      http.get(PROVIDER_URLS.frankfurterLatest, () =>
        jsonResponse({ rates: { NGN: 500 } }),
      ),
      http.post(PROVIDER_URLS.paystackInitialize, async ({ request }) => {
        paystackBody = await request.clone().text();
        return jsonResponse({
          status: true,
          message: "ok",
          data: {
            authorization_url: "https://checkout.paystack.com/abc",
            access_code: "ac123",
            reference: "ekwe_user123_uuid",
          },
        });
      }),
    );

    const res = await handleCheckoutInitialize(
      jsonRequest({ plan_id: "pro_monthly", currency: "NGN" }),
      mockEnv({ PAYSTACK_SECRET_KEY: "psk" }),
      "user-123",
      "test@ekwe.app",
    );

    expect(await res.json()).toEqual({
      url: "https://checkout.paystack.com/abc",
      reference: "ekwe_user123_uuid",
    });
    expect(paystackBody).toContain('"email":"test@ekwe.app"');
    expect(paystackBody).toContain('"currency":"NGN"');
    expect(paystackBody).toContain('"amount":150000');
    expect(paystackBody).toContain('"reference":"ekwe_user123_');
    expect(paystackBody).toContain('"user_id":"user-123"');
    expect(paystackBody).toContain('"plan_id":"pro_monthly"');
  });

  test("returns 502 when Paystack initialization fails", async () => {
    server.use(
      http.post(PROVIDER_URLS.paystackInitialize, () =>
        jsonResponse({}, 500),
      ),
    );
    const res = await handleCheckoutInitialize(
      jsonRequest({ plan_id: "pro_monthly", currency: "NGN" }),
      mockEnv({ PAYSTACK_SECRET_KEY: "psk" }),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "PAYMENT_INIT_FAILED" }),
    );
  });

  test("returns 502 when Paystack responds with status false", async () => {
    server.use(
      http.post(PROVIDER_URLS.paystackInitialize, () =>
        jsonResponse({ status: false, message: "bad" }),
      ),
    );
    const res = await handleCheckoutInitialize(
      jsonRequest({ plan_id: "pro_annual", currency: "NGN" }),
      mockEnv({ PAYSTACK_SECRET_KEY: "psk" }),
      "user-123",
      "test@ekwe.app",
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "PAYMENT_INIT_FAILED" }),
    );
  });
});
