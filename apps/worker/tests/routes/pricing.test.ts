import { describe, test, expect, beforeEach } from "vitest";
import { handleStorePricing, resetPricingCache } from "../../src/routes/pricing";
import { mockEnv, mockExecutionContext, jsonResponse } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

beforeEach(() => {
  resetPricingCache();
});

function pricingRequest(currency?: string): Request {
  const url = new URL("http://test/pricing");
  if (currency) url.searchParams.set("currency", currency);
  return new Request(url);
}

function mockConfig(
  base_price_usd: number,
  discount_percent: number,
  annual_discount_percent = 20,
): void {
  server.use(
    http.get(PROVIDER_URLS.supabaseSubscriptionConfig, () =>
      jsonResponse([{ base_price_usd, discount_percent, annual_discount_percent }]),
    ),
  );
}

describe("handleStorePricing", () => {
  test("returns USD monthly + annual pricing by default", async () => {
    mockConfig(2, 0);
    const res = await handleStorePricing(pricingRequest(), mockEnv(), mockExecutionContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      currency: "USD",
      price: 2,
      usd: 2,
      originalPriceUsd: 2,
      discountPercent: 0,
      annualPrice: 19.2,
      annualUsd: 19.2,
      originalAnnualUsd: 24,
      annualDiscountPercent: 20,
    });
  });

  test("converts monthly and annual to the requested currency", async () => {
    mockConfig(2, 0);
    server.use(
      http.get(PROVIDER_URLS.openErApiLatest, () =>
        jsonResponse({ rates: { NGN: 1500 } }),
      ),
    );
    const res = await handleStorePricing(pricingRequest("NGN"), mockEnv(), mockExecutionContext());
    const json = (await res.json()) as {
      currency: string;
      price: number;
      annualPrice: number;
      usd: number;
    };
    expect(json.currency).toBe("NGN");
    expect(json.price).toBe(3000);
    expect(json.annualPrice).toBe(28800);
    expect(json.usd).toBe(2);
  });

  test("applies the global discount to the monthly price", async () => {
    mockConfig(2, 40);
    server.use(
      http.get(PROVIDER_URLS.openErApiLatest, () =>
        jsonResponse({ rates: { NGN: 1500 } }),
      ),
    );
    const res = await handleStorePricing(pricingRequest("NGN"), mockEnv(), mockExecutionContext());
    const json = (await res.json()) as {
      price: number;
      usd: number;
      discountPercent: number;
      originalPriceUsd: number;
    };
    expect(json.usd).toBe(1.2);
    expect(json.price).toBe(1800);
    expect(json.discountPercent).toBe(40);
    expect(json.originalPriceUsd).toBe(2);
  });

  test("applies the annual discount on top of discounted monthly × 12", async () => {
    mockConfig(2, 40, 20);
    const res = await handleStorePricing(pricingRequest("USD"), mockEnv(), mockExecutionContext());
    const json = (await res.json()) as {
      annualUsd: number;
      originalAnnualUsd: number;
      annualDiscountPercent: number;
    };
    // monthly discounted = 1.20 → annual = 1.20 × 12 × 0.80 = 11.52
    expect(json.annualUsd).toBe(11.52);
    expect(json.originalAnnualUsd).toBe(24);
    expect(json.annualDiscountPercent).toBe(20);
  });

  test("falls back to defaults when the config row is unreadable", async () => {
    server.use(
      http.get(PROVIDER_URLS.supabaseSubscriptionConfig, () =>
        jsonResponse([], 500),
      ),
    );
    const res = await handleStorePricing(pricingRequest(), mockEnv(), mockExecutionContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      currency: "USD",
      price: 2,
      usd: 2,
      originalPriceUsd: 2,
      discountPercent: 0,
      annualPrice: 19.2,
      annualUsd: 19.2,
      originalAnnualUsd: 24,
      annualDiscountPercent: 20,
    });
  });

test("serves a cacheable header with a short TTL and SWR", async () => {
    mockConfig(2, 0);
    const res = await handleStorePricing(pricingRequest("USD"), mockEnv(), mockExecutionContext());
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });
});