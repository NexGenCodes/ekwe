import { describe, expect, it } from "vitest";

import {
  PLAN_CONFIG,
  FREE_LIMITS,
  PREMIUM_LIMITS,
  LOCAL_PRICES,
  PRO_PRODUCT_IDS,
  TTS_MAX_TEXT_CHARS,
} from "../plans";
import { FLUTTERWAVE_CURRENCIES } from "../money";

describe("PLAN_CONFIG", () => {
  it("has FREE and PREMIUM keys with limits and features", () => {
    expect(PLAN_CONFIG).toHaveProperty("FREE");
    expect(PLAN_CONFIG).toHaveProperty("PREMIUM");

    expect(PLAN_CONFIG.FREE).toHaveProperty("limits");
    expect(PLAN_CONFIG.FREE).toHaveProperty("features");

    expect(PLAN_CONFIG.PREMIUM).toHaveProperty("limits");
    expect(PLAN_CONFIG.PREMIUM).toHaveProperty("features");
  });
});

describe("Plan Limits (FREE vs PREMIUM)", () => {
  it("Premium has higher or equal limits for all quotas", () => {
    expect(PREMIUM_LIMITS.maxAudioBytes).toBeGreaterThan(
      FREE_LIMITS.maxAudioBytes,
    );
    expect(PREMIUM_LIMITS.maxTextChars).toBeGreaterThan(
      FREE_LIMITS.maxTextChars,
    );
    expect(PREMIUM_LIMITS.dictationDurationMs).toBeGreaterThan(
      FREE_LIMITS.dictationDurationMs,
    );
    expect(PREMIUM_LIMITS.historyRemoteTtlDays).toBeGreaterThan(
      FREE_LIMITS.historyRemoteTtlDays,
    );
  });

  it("Premium allows streaming, auto-detect, and transliteration", () => {
    expect(FREE_LIMITS.autoDetectAllowed).toBe(false);
    expect(PREMIUM_LIMITS.autoDetectAllowed).toBe(true);

    expect(FREE_LIMITS.streamingAllowed).toBe(false);
    expect(PREMIUM_LIMITS.streamingAllowed).toBe(true);

    expect(FREE_LIMITS.transliterationAllowed).toBe(false);
    expect(PREMIUM_LIMITS.transliterationAllowed).toBe(true);
  });
});

describe("LOCAL_PRICES", () => {
  it("contains all FLUTTERWAVE_CURRENCIES keys", () => {
    const priceKeys = Object.keys(LOCAL_PRICES);
    expect(priceKeys.sort()).toEqual([...FLUTTERWAVE_CURRENCIES].sort());
  });

  it("annual price is greater than monthly * 9 for all currencies", () => {
    for (const currency of FLUTTERWAVE_CURRENCIES) {
      const price = LOCAL_PRICES[currency];
      expect(price.annual).toBeGreaterThan(price.monthly * 9);
    }
  });

  it("has no zero or negative values", () => {
    for (const currency of FLUTTERWAVE_CURRENCIES) {
      const price = LOCAL_PRICES[currency];
      expect(price.monthly).toBeGreaterThan(0);
      expect(price.annual).toBeGreaterThan(0);
    }
  });
});

describe("PRO_PRODUCT_IDS", () => {
  it("matches expected subscription plan IDs", () => {
    expect(PRO_PRODUCT_IDS.monthly).toBe("ekwe_pro_monthly");
    expect(PRO_PRODUCT_IDS.annual).toBe("ekwe_pro_annual");
  });
});

describe("TTS_MAX_TEXT_CHARS", () => {
  it("is a positive number", () => {
    expect(typeof TTS_MAX_TEXT_CHARS).toBe("number");
    expect(TTS_MAX_TEXT_CHARS).toBeGreaterThan(0);
  });
});
