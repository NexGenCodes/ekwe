import { describe, expect, test } from "vitest";

import {
  getCurrencySymbol,
  computeSavingPercent,
  formatMoney,
  getDecimals,
  roundToCurrency,
  toLowestUnit,
  countryToCurrency,
} from "./money";
import { LANGUAGES, getLanguageFlag, languageName } from "./languages";

describe("languages registry", () => {
  test("LANGUAGES is the provider allowlist with derived names", () => {
    expect(LANGUAGES.length).toBe(139);
    expect(LANGUAGES[0]).toEqual({
      code: "en",
      englishName: "English",
      nativeName: "English",
    });
    expect(LANGUAGES.find((l) => l.code === "zh")?.englishName).toBe(
      "Chinese (Simplified)",
    );
  });

  test("non-ISO codes fall back to overrides, not a missing name", () => {
    for (const code of ["ci", "ck", "yue", "haw"]) {
      expect(languageName(code)).not.toBe(code);
    }
    expect(languageName("zz")).toBe("zz");
  });

  test("getLanguageFlag returns representative country flags", () => {
    expect(getLanguageFlag("en")).toBe("🇬🇧");
    expect(getLanguageFlag("yo")).toBe("🇳🇬");
    expect(getLanguageFlag("yue")).toBe("🇭🇰");
    expect(getLanguageFlag("auto")).toBe("🌐");
    expect(getLanguageFlag("zz")).toBe("🏳️");
  });
});

describe("money helpers", () => {
  test("getDecimals comes from CLDR and falls back to 2", () => {
    expect(getDecimals("USD")).toBe(2);
    expect(getDecimals("XOF")).toBe(0);
    expect(getDecimals("ZZZ")).toBe(2);
  });

  test("getCurrencySymbol comes from CLDR", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("EUR")).toBe("€");
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

  test("countryToCurrency maps target-market countries to their currency", () => {
    expect(countryToCurrency("NG")).toBe("NGN");
    expect(countryToCurrency("GH")).toBe("GHS");
    expect(countryToCurrency("US")).toBe("USD");
    expect(countryToCurrency("gb")).toBe("GBP");
    expect(countryToCurrency("SN")).toBe("XOF");
  });

  test("countryToCurrency covers countries beyond the old hand-maintained map", () => {
    expect(countryToCurrency("PL")).toBe("PLN");
    expect(countryToCurrency("BR")).toBe("BRL");
    expect(countryToCurrency("JP")).toBe("JPY");
    expect(countryToCurrency("ZAR")).toBeUndefined();
  });

  test("countryToCurrency returns undefined for unknown countries", () => {
    expect(countryToCurrency("XA")).toBeUndefined();
    expect(countryToCurrency("")).toBeUndefined();
  });
});