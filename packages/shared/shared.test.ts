import { describe, expect, test } from "vitest";

import {
  CURRENCIES,
  CURRENCY_BY_CODE,
  COUNTRY_TO_CURRENCY_CODE,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCY_CODES,
  getCurrency,
} from "./currencies";
import {
  computeSavingPercent,
  formatMoney,
  getDecimals,
  roundToCurrency,
  toLowestUnit,
} from "./money";

describe("currencies registry", () => {
  test("USD is the default currency", () => {
    expect(DEFAULT_CURRENCY).toBe("USD");
    expect(getCurrency("usd")?.code).toBe("USD");
  });

  test("registry is the single source for supported codes", () => {
    expect(SUPPORTED_CURRENCY_CODES).toEqual(
      CURRENCIES.map((c) => c.code),
    );
    expect(CURRENCY_BY_CODE.size).toBe(CURRENCIES.length);
  });

  test("lookup is case-insensitive and unknown codes return undefined", () => {
    expect(getCurrency("ngn")?.symbol).toBe("₦");
    expect(getCurrency("EUR")?.decimals).toBe(2);
    expect(getCurrency("JPY")).toBeUndefined();
  });

  test("every currency has symbol, decimals, flag, region, and fallback rate", () => {
    for (const c of CURRENCIES) {
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(c.decimals).toBeGreaterThanOrEqual(0);
      expect(c.flag.length).toBeGreaterThan(0);
      expect(c.region.length).toBeGreaterThan(0);
      expect(c.fallbackRate).toBeGreaterThan(0);
    }
  });

  test("country-to-currency map keys resolve to supported currencies", () => {
    for (const code of Object.values(COUNTRY_TO_CURRENCY_CODE)) {
      expect(getCurrency(code)).toBeDefined();
    }
  });
});

describe("money helpers", () => {
  test("getDecimals falls back to 2 for unknown codes", () => {
    expect(getDecimals("USD")).toBe(2);
    expect(getDecimals("XOF")).toBe(0);
    expect(getDecimals("ZZZ")).toBe(2);
  });

  test("roundToCurrency respects per-currency decimals", () => {
    expect(roundToCurrency(3.005, "USD")).toBe(3.01);
    expect(roundToCurrency(1234.5, "XOF")).toBe(1235);
  });

  test("toLowestUnit converts to integer minor units", () => {
    expect(toLowestUnit(3.0, "USD")).toBe(300);
    expect(toLowestUnit(28.8, "USD")).toBe(2880);
    expect(toLowestUnit(1234.5, "XOF")).toBe(1235);
  });

  test("computeSavingPercent matches annual-vs-monthly discount", () => {
    expect(computeSavingPercent(3.0, 28.8)).toBe(20);
    expect(computeSavingPercent(10, 120)).toBe(0);
  });

  test("formatMoney uses the currency symbol and locale grouping", () => {
    expect(formatMoney(3, "USD")).toBe("$3");
    expect(formatMoney(1234.56, "USD")).toBe("$1,234.56");
    expect(formatMoney(28.8, "USD")).toBe("$28.80");
  });
});
