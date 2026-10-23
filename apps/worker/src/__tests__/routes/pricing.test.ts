import { beforeEach, describe, expect, test } from "vitest";
import { handleStorePricing, resetPricingCache } from "@/routes/pricing";
import type { Env } from "@/core/types";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";
import { jsonBody, mockExecutionContext } from "@/__tests__/setup";

function makeEnv(database: TestDatabase): Env {
  return { DB: database.d1, APP_ENV: "test" } as unknown as Env;
}

function pricingRequest(
  currency?: string,
  headers?: Record<string, string>,
): Request {
  const url = new URL("http://test/pricing");
  if (currency) url.searchParams.set("currency", currency);
  return new Request(url, { headers });
}

function seedConfig(
  database: TestDatabase,
  config: {
    basePriceUsd?: number;
    discountPercent?: number;
    annualDiscountPercent?: number;
    localPrices?: Record<string, { monthly: number; annual: number }>;
  },
): void {
  database.sqlite
    .prepare(
      `UPDATE app_config
          SET base_price_usd = ?, discount_percent = ?, annual_discount_percent = ?,
              local_prices = ?, updated_at = ?
        WHERE id = 1`,
    )
    .run(
      config.basePriceUsd ?? 2.23,
      config.discountPercent ?? 0,
      config.annualDiscountPercent ?? 20,
      JSON.stringify(config.localPrices ?? {}),
      Date.now(),
    );
}

describe("handleStorePricing", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    resetPricingCache();
    database = createTestDatabase();
    env = makeEnv(database);
  });

  test("returns NGN monthly + annual pricing by default", async () => {
    const res = await handleStorePricing(
      pricingRequest(),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      currency: "NGN",
      price: 3000,
      usd: 2.23,
      originalPriceUsd: 2.23,
      discountPercent: 0,
      annualPrice: 28800,
      annualUsd: 21.41,
      originalAnnualUsd: 26.76,
      annualDiscountPercent: 20,
    });
  });

  test("serves an explicit currency without relying on geo headers", async () => {
    const res = await handleStorePricing(
      pricingRequest("USD", { "CF-IPCountry": "NG" }),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      currency: "USD",
      price: 2.23,
      annualPrice: 21.41,
    });
  });

  test("falls back to NGN for unsupported currencies", async () => {
    const res = await handleStorePricing(
      pricingRequest("BRL"),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      currency: "NGN",
      price: 3000,
    });
  });

  test("prefers local_prices from app_config over the bundled defaults", async () => {
    seedConfig(database, {
      basePriceUsd: 2.5,
      localPrices: { NGN: { monthly: 4000, annual: 38400 } },
    });

    const res = await handleStorePricing(
      pricingRequest("NGN"),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      currency: "NGN",
      price: 4000,
      annualPrice: 38400,
      originalPriceUsd: 2.5,
    });
  });

  test("ignores malformed local_prices instead of failing", async () => {
    database.sqlite
      .prepare("UPDATE app_config SET local_prices = ? WHERE id = 1")
      .run("not json");

    const res = await handleStorePricing(
      pricingRequest("NGN"),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      currency: "NGN",
      price: 3000,
    });
  });

  test("serves a cacheable header with a short TTL and SWR", async () => {
    const res = await handleStorePricing(
      pricingRequest("USD"),
      env,
      mockExecutionContext(),
    );

    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });
});
