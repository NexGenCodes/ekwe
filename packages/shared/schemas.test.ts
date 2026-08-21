import { describe, expect, test } from "vitest";

import {
  checkoutRequestSchema,
  checkoutResponseSchema,
  otpRequestSchema,
  registerPushTokenRequestSchema,
  storePricingResponseSchema,
  transcribeResponseSchema,
  translateRequestSchema,
  translateResponseSchema,
  ttsRequestSchema,
  usageSnapshotSchema,
} from "./schemas";

describe("otpRequestSchema", () => {
  test("accepts a normalized email and token", () => {
    const parsed = otpRequestSchema.safeParse({
      email: "  User@Example.COM ",
      turnstileToken: "0.token",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("user@example.com");
    }
  });

  test("rejects invalid email shapes on the email field", () => {
    for (const email of ["", "not-an-email", "a@b", "a b@c.co", "@x.co"]) {
      const parsed = otpRequestSchema.safeParse({
        email,
        turnstileToken: "0.token",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path[0]).toBe("email");
      }
    }
  });

  test("rejects email over 254 chars on the email field", () => {
    const parsed = otpRequestSchema.safeParse({
      email: `${"a".repeat(250)}@b.co`,
      turnstileToken: "0.token",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path[0]).toBe("email");
    }
  });

  test("accepts missing token, rejects oversized token on the token field", () => {
    const missing = otpRequestSchema.safeParse({ email: "a@b.co" });
    expect(missing.success).toBe(true);
    if (missing.success) {
      expect(missing.data.turnstileToken).toBeUndefined();
    }

    const oversized = otpRequestSchema.safeParse({
      email: "a@b.co",
      turnstileToken: "x".repeat(2049),
    });
    expect(oversized.success).toBe(false);
    if (!oversized.success) {
      expect(oversized.error.issues[0]?.path[0]).toBe("turnstileToken");
    }
  });
});

describe("storePricingResponseSchema", () => {
  test("validates monthly + annual pricing with discount metadata", () => {
    const parsed = storePricingResponseSchema.safeParse({
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
    expect(parsed.success).toBe(true);
  });

  test("rejects a response missing annual fields", () => {
    const parsed = storePricingResponseSchema.safeParse({
      currency: "USD",
      price: 2,
      usd: 2,
      discountPercent: 0,
      originalPriceUsd: 2,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("translateRequestSchema", () => {
  test("accepts a valid translate body (sourceLang optional)", () => {
    expect(
      translateRequestSchema.safeParse({
        text: "hello",
        targetLang: "yo",
      }).success,
    ).toBe(true);
    expect(
      translateRequestSchema.safeParse({
        text: "hello",
        targetLang: "yo",
        sourceLang: "en",
      }).success,
    ).toBe(true);
  });

  test("rejects a body missing text or targetLang", () => {
    expect(translateRequestSchema.safeParse({ targetLang: "yo" }).success).toBe(
      false,
    );
    expect(translateRequestSchema.safeParse({ text: "hi" }).success).toBe(
      false,
    );
  });
});

describe("translateResponseSchema", () => {
  test("accepts a translation with optional extras", () => {
    expect(
      translateResponseSchema.safeParse({
        translation: "Pẹlẹ o",
        provider: "gemini",
        language: "yo",
        transliteration: "Pẹlẹ o",
      }).success,
    ).toBe(true);
    expect(
      translateResponseSchema.safeParse({
        translation: "Pẹlẹ o",
        provider: "gemini",
      }).success,
    ).toBe(true);
  });

  test("rejects a response without translation", () => {
    expect(
      translateResponseSchema.safeParse({ provider: "gemini" }).success,
    ).toBe(false);
  });
});

describe("transcribeResponseSchema", () => {
  test("accepts a transcript with optional duration/language", () => {
    expect(
      transcribeResponseSchema.safeParse({
        text: "hello world",
        duration: 1.5,
        language: "en",
        provider: "deepgram",
      }).success,
    ).toBe(true);
    expect(
      transcribeResponseSchema.safeParse({
        text: "hello",
        provider: "deepgram",
      }).success,
    ).toBe(true);
  });

  test("rejects a transcript without provider", () => {
    expect(transcribeResponseSchema.safeParse({ text: "hello" }).success).toBe(
      false,
    );
  });
});

describe("usageSnapshotSchema", () => {
  test("validates the usage snapshot shape", () => {
    const parsed = usageSnapshotSchema.safeParse({
      day: "2026-08-13",
      resetsAt: 1784160000000,
      translate: { used: 2, total: 25, remaining: 23 },
      transcribe: { used: 0, total: 10, remaining: 10 },
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects a snapshot missing quota pools", () => {
    const parsed = usageSnapshotSchema.safeParse({ day: "2026-08-13" });
    expect(parsed.success).toBe(false);
  });
});

describe("ttsRequestSchema", () => {
  test("accepts a minimal TTS body", () => {
    expect(
      ttsRequestSchema.safeParse({ text: "Hello", lang: "en" }).success,
    ).toBe(true);
  });

  test("accepts an explicit gender", () => {
    expect(
      ttsRequestSchema.safeParse({
        text: "Hello",
        lang: "en",
        gender: "male",
      }).success,
    ).toBe(true);
  });

  test("rejects a body missing text or lang", () => {
    expect(ttsRequestSchema.safeParse({ lang: "en" }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: "hi" }).success).toBe(false);
    expect(ttsRequestSchema.safeParse({ text: "", lang: "en" }).success).toBe(
      false,
    );
  });

  test("rejects an unknown gender", () => {
    expect(
      ttsRequestSchema.safeParse({ text: "hi", lang: "en", gender: "other" })
        .success,
    ).toBe(false);
  });
});

describe("checkoutRequestSchema", () => {
  test("accepts a valid monthly checkout", () => {
    expect(
      checkoutRequestSchema.safeParse({
        plan: "ekwe_pro_monthly",
      }).success,
    ).toBe(true);
  });

  test("accepts an annual checkout with a currency", () => {
    expect(
      checkoutRequestSchema.safeParse({
        plan: "ekwe_pro_annual",
        currency: "NGN",
      }).success,
    ).toBe(true);
  });

  test("rejects an unknown plan", () => {
    expect(
      checkoutRequestSchema.safeParse({
        plan: "ekwe_pro_weekly",
      }).success,
    ).toBe(false);
  });

  test("rejects an empty plan", () => {
    expect(
      checkoutRequestSchema.safeParse({
        plan: "",
      }).success,
    ).toBe(false);
  });

  test("rejects a malformed currency", () => {
    expect(
      checkoutRequestSchema.safeParse({
        plan: "ekwe_pro_monthly",
        currency: "BANANA",
      }).success,
    ).toBe(false);
  });
});

describe("checkoutResponseSchema", () => {
  test("accepts a valid checkout response", () => {
    expect(
      checkoutResponseSchema.safeParse({
        tx_ref: "ekwe_user_monthly_1234",
        amount: 19.2,
        currency: "USD",
      }).success,
    ).toBe(true);
  });

  test("rejects a response missing tx_ref", () => {
    expect(
      checkoutResponseSchema.safeParse({
        amount: 19.2,
        currency: "USD",
      }).success,
    ).toBe(false);
  });

  test("rejects a response missing amount", () => {
    expect(
      checkoutResponseSchema.safeParse({
        tx_ref: "ekwe_user_monthly_1234",
        currency: "USD",
      }).success,
    ).toBe(false);
  });
});

describe("registerPushTokenRequestSchema", () => {
  test("accepts a valid Expo push token", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[abc123]",
        platform: "android",
      }).success,
    ).toBe(true);
  });

  test("accepts an app_version", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[abc123]",
        platform: "ios",
        app_version: "1.2.3",
      }).success,
    ).toBe(true);
  });

  test("rejects a non-Expo token string", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "APNs-abc123",
        platform: "ios",
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown platform", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[abc123]",
        platform: "web",
      }).success,
    ).toBe(false);
  });
});
