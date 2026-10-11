import { describe, expect, test } from "vitest";

import {
  getCurrencySymbol,
  computeSavingPercent,
  formatMoney,
  getDecimals,
  roundToCurrency,
  toLowestUnit,
  countryToCurrency,
  countryNamesForCurrency,
  countrySummaryForCurrency,
  DEFAULT_PAYMENT_CURRENCY,
  isSupportedPaymentCurrency,
  resolvePaymentCurrency,
} from "../money";
import {
  ALL_LANGUAGES,
  LANGUAGES,
  LANGUAGE_CODE_SET,
  SUPPORTED_LANGUAGE_CODES,
  getLanguageFlag,
  isSupportedLanguage,
  languageName,
} from "../languages";

describe("languages registry", () => {
  test("LANGUAGES is the offered set, not the whole catalog", () => {
    // LANGUAGES is what every picker renders, so it is the supported tier. The
    // complete catalog lives in ALL_LANGUAGES / LANGUAGE_CODES.
    expect(LANGUAGES.length).toBe(SUPPORTED_LANGUAGE_CODES.length);
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(
      [...SUPPORTED_LANGUAGE_CODES].sort(),
    );
    expect(LANGUAGES[0]).toEqual({
      code: "en",
      englishName: "English",
      nativeName: "English",
    });
    expect(LANGUAGES.find((l) => l.code === "zh")?.englishName).toBe(
      "Chinese (Simplified)",
    );
  });

  test("the offered set is a subset of the catalog", () => {
    // The catalog stays complete so names and stored values still resolve for a
    // language we once offered; the tier can only ever narrow it.
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(LANGUAGE_CODE_SET.has(code), `${code} missing from catalog`).toBe(
        true,
      );
    }
    expect(LANGUAGE_CODE_SET.size).toBeGreaterThan(
      SUPPORTED_LANGUAGE_CODES.length,
    );
    expect(isSupportedLanguage("yo")).toBe(false);
    expect(isSupportedLanguage("en")).toBe(true);
    expect(isSupportedLanguage("zz")).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  test("names still resolve for a language we no longer offer", () => {
    // Dropping Yoruba from the picker must not make stored values or provider
    // detections unreadable — that is what ALL_LANGUAGES is for.
    expect(languageName("yo")).toBe("Yoruba");
    expect(ALL_LANGUAGES.length).toBe(LANGUAGE_CODE_SET.size);
    expect(LANGUAGES.some((l) => l.code === "yo")).toBe(false);
  });

  test("non-ISO codes fall back to overrides, not a missing name", () => {
    // Cherokee, Sicilian and Hawaiian are catalog languages we do not offer;
    // they must still resolve by name.
    for (const code of ["ci", "ck", "haw"]) {
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

  test("every Flutterwave-billable currency has a proper symbol", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("NGN")).toBe("₦");
    expect(getCurrencySymbol("GHS")).toBe("₵");
    expect(getCurrencySymbol("KES")).toBe("sh");
    expect(getCurrencySymbol("ZAR")).toBe("R");
    expect(getCurrencySymbol("ZMW")).toBe("ZK");
    expect(getCurrencySymbol("UGX")).toBe("USh");
    expect(getCurrencySymbol("TZS")).toBe("TSh");
    expect(getCurrencySymbol("RWF")).toBe("RF");
    expect(getCurrencySymbol("XOF")).toBe("FCFA");
    expect(getCurrencySymbol("XAF")).toBe("FCFA");
    expect(getCurrencySymbol("GBP")).toBe("£");
    expect(getCurrencySymbol("EUR")).toBe("€");
    expect(getCurrencySymbol("CAD")).toBe("C$");
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

  test("currency resolution filters to supported payment currencies", () => {
    expect(DEFAULT_PAYMENT_CURRENCY).toBe("NGN");
    expect(isSupportedPaymentCurrency("NGN")).toBe(true);
    expect(isSupportedPaymentCurrency("PLN")).toBe(false);
    expect(resolvePaymentCurrency("USD")).toBe("USD");
    expect(resolvePaymentCurrency("PLN")).toBe("NGN");
  });

  test("countryNamesForCurrency lists every country using a currency", () => {
    expect(countryNamesForCurrency("XOF")).toEqual([
      "Benin",
      "Burkina Faso",
      "Guinea-Bissau",
      "Ivory Coast",
      "Mali",
      "Niger",
      "Senegal",
      "Togo",
    ]);
    expect(countryNamesForCurrency("GHS")).toEqual(["Ghana"]);
  });

  test("countrySummaryForCurrency compacts long country sets", () => {
    expect(countrySummaryForCurrency("XOF")).toBe(
      "Benin, Burkina Faso & 6 more",
    );
    expect(countrySummaryForCurrency("XOF", 3)).toBe(
      "Benin, Burkina Faso, Guinea-Bissau & 5 more",
    );
    expect(countrySummaryForCurrency("GHS")).toBe("Ghana");
  });
});
