import { describe, test, expect, beforeEach } from "vitest";
import { handleStorePricing, resetPricingCache } from "../../routes/pricing";
import { mockEnv, mockExecutionContext } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

function pricingRequest(
  currency?: string,
  headers?: Record<string, string>,
): Request {
  const url = new URL("http://test/pricing");
  if (currency) url.searchParams.set("currency", currency);
  return new Request(url, { headers });
}

describe("handleStorePricing", () => {
  beforeEach(() => {
    resetPricingCache();
    server.resetHandlers();
  });

  test("returns USD monthly + annual pricing by default", async () => {
    const res = await handleStorePricing(
      pricingRequest(),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toEqual({
      currency: "USD",
      price: 2.23,
      usd: 2.23,
      originalPriceUsd: 2.23,
      discountPercent: 0,
      annualPrice: 21.41,
      annualUsd: 21.41,
      originalAnnualUsd: 26.76,
      annualDiscountPercent: 20,
    });
  });

  test("serves static local prices for a supported currency", async () => {
    const res = await handleStorePricing(
      pricingRequest("NGN"),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.currency).toBe("NGN");
    expect(json.price).toBe(3000);
    expect(json.annualPrice).toBe(28800);
    expect(json.usd).toBe(2.23);
    expect(json.discountPercent).toBe(0);
    expect(json.annualDiscountPercent).toBe(20);
  });

  test("falls back to USD for unsupported currencies", async () => {
    const res = await handleStorePricing(
      pricingRequest("BRL"),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.currency).toBe("USD");
    expect(json.price).toBe(2.23);
  });

  test("resolves currency from geo CF-IPCountry when none is explicit", async () => {
    // No explicit currency, but the request comes from Nigeria (NG → NGN): the
    // worker should bill in NGN, not fall back to USD. This is the battle-tested
    // path that fixes the Android locale misreporting bug.
    const res = await handleStorePricing(
      pricingRequest(undefined, { "CF-IPCountry": "NG" }),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.currency).toBe("NGN");
    expect(json.price).toBe(3000);
  });

  test("explicit currency wins over geo CF-IPCountry", async () => {
    // User is geo-Ghana (GH → GHS) but explicitly chose USD — manual wins.
    const res = await handleStorePricing(
      pricingRequest("USD", { "CF-IPCountry": "GH" }),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.currency).toBe("USD");
  });

  test("unmapped geo country falls back to USD", async () => {
    const res = await handleStorePricing(
      pricingRequest(undefined, { "CF-IPCountry": "XX" }),
      mockEnv(),
      mockExecutionContext(),
    );
    const json = (await res.json()) as any;
    expect(json.currency).toBe("USD");
  });

  test("reads local_prices from the app_config row in Supabase", async () => {
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

    const res = await handleStorePricing(
      pricingRequest("NGN"),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.currency).toBe("NGN");
    expect(json.price).toBe(4000);
    expect(json.annualPrice).toBe(38400);
    expect(json.originalPriceUsd).toBe(2.5);
  });

  test("serves a cacheable header with a short TTL and SWR", async () => {
    const res = await handleStorePricing(
      pricingRequest("USD"),
      mockEnv(),
      mockExecutionContext(),
    );
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });
});
