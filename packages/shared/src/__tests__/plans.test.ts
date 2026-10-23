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
    for (const limits of [FREE_LIMITS, PREMIUM_LIMITS]) {
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
    }
  });

  it("Premium has higher daily and monthly AI caps than FREE", () => {
    expect(PREMIUM_LIMITS.dailyTranslateLimit).toBeGreaterThan(
      FREE_LIMITS.dailyTranslateLimit,
    );
    expect(PREMIUM_LIMITS.dailyTranscribeMinutesLimit).toBeGreaterThan(
      FREE_LIMITS.dailyTranscribeMinutesLimit,
    );
    expect(PREMIUM_LIMITS.monthlyTranslateLimit).toBeGreaterThan(
      FREE_LIMITS.monthlyTranslateLimit,
    );
    expect(PREMIUM_LIMITS.monthlyTranscribeMinutesLimit).toBeGreaterThan(
      FREE_LIMITS.monthlyTranscribeMinutesLimit,
    );
    expect(PREMIUM_LIMITS.monthlySpeechCharsLimit).toBeGreaterThan(
      FREE_LIMITS.monthlySpeechCharsLimit,
    );
    expect(PREMIUM_LIMITS.monthlyAiCreditsLimit).toBeGreaterThan(
      FREE_LIMITS.monthlyAiCreditsLimit,
    );
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
