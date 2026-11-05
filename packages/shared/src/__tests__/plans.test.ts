import { describe, expect, it } from "vitest";

import {
  PLAN_CONFIG,
  FREE_LIMITS,
  PREMIUM_LIMITS,
  LOCAL_PRICES,
  PRO_PRODUCT_IDS,
  SPEECH_MAX_TEXT_CHARS,
  aiCreditsForUsage,
} from "../plans";
import { FLUTTERWAVE_CURRENCIES } from "../money";
import { HISTORY_TTL_FREE_DAYS, HISTORY_TTL_PAID_DAYS } from "../retention";

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
    expect(PREMIUM_LIMITS.maxTextChars).toBeGreaterThanOrEqual(
      FREE_LIMITS.maxTextChars,
    );
    expect(PREMIUM_LIMITS.dictationDurationMs).toBeGreaterThan(
      FREE_LIMITS.dictationDurationMs,
    );
    expect(PREMIUM_LIMITS.historyRemoteTtlDays).toBeGreaterThan(
      FREE_LIMITS.historyRemoteTtlDays,
    );
    expect(FREE_LIMITS.historyRemoteTtlDays).toBe(HISTORY_TTL_FREE_DAYS);
    expect(PREMIUM_LIMITS.historyRemoteTtlDays).toBe(HISTORY_TTL_PAID_DAYS);
  });

  it("Premium allows streaming, auto-detect, and transliteration", () => {
    expect(FREE_LIMITS.autoDetectAllowed).toBe(false);
    expect(PREMIUM_LIMITS.autoDetectAllowed).toBe(true);

    expect(FREE_LIMITS.streamingAllowed).toBe(false);
    expect(PREMIUM_LIMITS.streamingAllowed).toBe(true);

    expect(FREE_LIMITS.transliterationAllowed).toBe(false);
    expect(PREMIUM_LIMITS.transliterationAllowed).toBe(true);
  });

  it("the shared credit pool covers every monthly feature cap", () => {
    // Only check PREMIUM — Free tier is daily-governed, so its monthly values
    // are Infinity and the credit pool test is meaningless for it.
    const limits = PREMIUM_LIMITS;
    const maxCredits =
      aiCreditsForUsage("translate", {
        chars: limits.monthlyTranslateLimit * 1_000,
      }) +
      aiCreditsForUsage("transcribe", {
        durationMs: limits.monthlyTranscribeMinutesLimit * 60_000,
      }) +
      aiCreditsForUsage("speech", {
        chars: limits.monthlySpeechCharsLimit,
      }) +
      aiCreditsForUsage("stream", {
        durationMs: limits.monthlyStreamMinutesLimit * 60_000,
      });

    expect(maxCredits).toBeLessThanOrEqual(limits.monthlyAiCreditsLimit);
  });

  it("Free is daily-governed and Paid is monthly-governed", () => {
    // Free tier: finite daily caps, no monthly caps (Infinity)
    expect(Number.isFinite(FREE_LIMITS.dailyTranslateLimit)).toBe(true);
    expect(Number.isFinite(FREE_LIMITS.dailyTranscribeMinutesLimit)).toBe(true);
    expect(Number.isFinite(FREE_LIMITS.dailySpeechCharsLimit)).toBe(true);
    expect(FREE_LIMITS.monthlyTranslateLimit).toBe(Infinity);
    expect(FREE_LIMITS.monthlyTranscribeMinutesLimit).toBe(Infinity);
    expect(FREE_LIMITS.monthlySpeechCharsLimit).toBe(Infinity);

    // Paid tier: no daily caps (Infinity), finite monthly soft-caps
    expect(PREMIUM_LIMITS.dailyTranslateLimit).toBe(Infinity);
    expect(PREMIUM_LIMITS.dailyTranscribeMinutesLimit).toBe(Infinity);
    expect(PREMIUM_LIMITS.dailySpeechCharsLimit).toBe(Infinity);
    expect(Number.isFinite(PREMIUM_LIMITS.monthlyTranslateLimit)).toBe(true);
    expect(Number.isFinite(PREMIUM_LIMITS.monthlyTranscribeMinutesLimit)).toBe(
      true,
    );
    expect(Number.isFinite(PREMIUM_LIMITS.monthlySpeechCharsLimit)).toBe(true);
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

describe("SPEECH_MAX_TEXT_CHARS", () => {
  it("is a positive number", () => {
    expect(typeof SPEECH_MAX_TEXT_CHARS).toBe("number");
    expect(SPEECH_MAX_TEXT_CHARS).toBeGreaterThan(0);
  });
});
