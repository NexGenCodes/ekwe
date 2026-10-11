import { describe, expect, test } from "vitest";

import {
  billingFlagsResponseSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  loginSchema,
  otpRequestSchema,
  otpSchema,
  registerPushTokenRequestSchema,
  storePricingResponseSchema,
  synthesizeRequestSchema,
  synthesizeResponseSchema,
  transcribeResponseSchema,
  translateRequestSchema,
  translateResponseSchema,
  pushNotifyRequestSchema,
  updateManifestSchema,
  webhookEventSchema,
  translationSchema,
  usageSnapshotSchema,
  verifyTransactionRequestSchema,
  verifyTransactionResponseSchema,
} from "../schemas";

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

describe("loginSchema", () => {
  test("accepts a valid email", () => {
    expect(loginSchema.safeParse({ email: "user@example.com" }).success).toBe(
      true,
    );
  });

  test("normalizes like the wire schema (trim + lowercase)", () => {
    const parsed = loginSchema.safeParse({ email: "  User@Example.COM " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("user@example.com");
    }
  });

  test("rejects a malformed email with a user-facing message", () => {
    const parsed = loginSchema.safeParse({ email: "not-an-email" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "Please enter a valid email address.",
      );
    }
  });

  test("caps length at 254 with a user-facing message", () => {
    const parsed = loginSchema.safeParse({ email: `${"a".repeat(250)}@b.co` });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "Please enter a valid email address.",
      );
    }
  });

  test("rejects a missing email", () => {
    expect(loginSchema.safeParse({}).success).toBe(false);
  });

  test("form and wire accept identical email sets", () => {
    const cases = [
      "user@example.com",
      "USER@EXAMPLE.COM",
      "not-an-email",
      "",
      "@x.co",
      "a b@c.co",
      `${"a".repeat(250)}@b.co`,
    ];
    for (const email of cases) {
      const viaForm = loginSchema.safeParse({ email }).success;
      const viaWire = otpRequestSchema.safeParse({ email }).success;
      expect(viaForm).toBe(viaWire);
    }
  });
});

describe("otpSchema", () => {
  test("accepts a 6-digit token", () => {
    expect(otpSchema.safeParse({ token: "123456" }).success).toBe(true);
  });

  test("rejects tokens that are not exactly 6 chars", () => {
    for (const token of ["", "12345", "1234567", "abcdefg"]) {
      const parsed = otpSchema.safeParse({ token });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path[0]).toBe("token");
      }
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
        targetLang: "fr",
      }).success,
    ).toBe(true);
    expect(
      translateRequestSchema.safeParse({
        text: "hello",
        targetLang: "fr",
        sourceLang: "es",
      }).success,
    ).toBe(true);
  });

  test("rejects a body missing text or targetLang", () => {
    expect(translateRequestSchema.safeParse({ targetLang: "fr" }).success).toBe(
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
      meters: [
        {
          id: "translate",
          label: "Translations",
          unit: "requests",
          used: 2,
          total: 25,
          remaining: 23,
        },
        {
          id: "transcribe",
          label: "Transcriptions",
          unit: "requests",
          used: 0,
          total: 10,
          remaining: 10,
        },
        {
          id: "speech",
          label: "Speech",
          unit: "characters",
          used: 40,
          total: 5000,
          remaining: 4960,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects a snapshot missing quota meters", () => {
    const parsed = usageSnapshotSchema.safeParse({ day: "2026-08-13" });
    expect(parsed.success).toBe(false);
  });

  test("rejects a meter with an unknown id", () => {
    const parsed = usageSnapshotSchema.safeParse({
      day: "2026-08-13",
      resetsAt: 1784160000000,
      meters: [
        {
          id: "stream",
          label: "Stream",
          unit: "seconds",
          used: 1,
          total: 2,
          remaining: 1,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("translationSchema", () => {
  test("accepts distinct languages and non-empty text", () => {
    expect(
      translationSchema.safeParse({
        text: "hello",
        sourceLang: "en",
        targetLang: "yo",
      }).success,
    ).toBe(true);
  });

  test("accepts auto-detect even when it matches the target code", () => {
    expect(
      translationSchema.safeParse({
        text: "hello",
        sourceLang: "auto",
        targetLang: "auto",
      }).success,
    ).toBe(true);
  });

  test("rejects empty text with a user-facing message", () => {
    const parsed = translationSchema.safeParse({
      text: "",
      sourceLang: "en",
      targetLang: "yo",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "Please enter text to translate.",
      );
    }
  });

  test("rejects the 'none' placeholder on either language", () => {
    for (const sourceLang of ["none", "en"]) {
      const parsed = translationSchema.safeParse({
        text: "hello",
        sourceLang,
        targetLang: sourceLang === "none" ? "yo" : "none",
      });
      expect(parsed.success).toBe(false);
    }
  });

  test("rejects identical concrete languages on the targetLang path", () => {
    const parsed = translationSchema.safeParse({
      text: "hello",
      sourceLang: "yo",
      targetLang: "yo",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path[0]).toBe("targetLang");
      expect(parsed.error.issues[0]?.message).toBe(
        "Source and target languages cannot be the same.",
      );
    }
  });
});

describe("pushNotifyRequestSchema", () => {
  test("accepts the release workflow payload", () => {
    expect(
      pushNotifyRequestSchema.safeParse({
        version: "1.2.9",
        versionCode: 10209,
        downloadUrl: "https://cdn.example.com/app-release.apk",
        checksumSha256: "ab".repeat(32),
      }).success,
    ).toBe(true);
  });

  test("treats versionCode and checksumSha256 as optional", () => {
    expect(
      pushNotifyRequestSchema.safeParse({
        version: "1.2.9",
        downloadUrl: "https://cdn.example.com/app-release.apk",
      }).success,
    ).toBe(true);
  });

  test("rejects a non-https or missing downloadUrl", () => {
    expect(
      pushNotifyRequestSchema.safeParse({
        version: "1.2.9",
        downloadUrl: "http://insecure.example.com/app.apk",
      }).success,
    ).toBe(false);
    expect(
      pushNotifyRequestSchema.safeParse({
        version: "1.2.9",
        downloadUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  test("rejects a malformed checksum or non-positive versionCode", () => {
    expect(
      pushNotifyRequestSchema.safeParse({
        version: "1.2.9",
        versionCode: -1,
        downloadUrl: "https://cdn.example.com/app-release.apk",
      }).success,
    ).toBe(false);
    expect(
      pushNotifyRequestSchema.safeParse({
        version: "1.2.9",
        downloadUrl: "https://cdn.example.com/app-release.apk",
        checksumSha256: "zzz",
      }).success,
    ).toBe(false);
  });
});

describe("updateManifestSchema", () => {
  test("accepts the generated version.json and preserves extra keys", () => {
    const result = updateManifestSchema.safeParse({
      latest_version: "1.2.9",
      latest_version_code: 10209,
      min_supported_version_code: 1,
      download_url: "https://cdn.example.com/app-release.apk",
      checksum_sha256: "ab".repeat(32),
      file_size: 42_000_000,
      release_notes: "",
      release_date: "2026-09-20",
      force_update: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.release_date).toBe("2026-09-20");
      expect(result.data.force_update).toBe(false);
    }
  });

  test("rejects a body missing required fields or with a bad download_url", () => {
    expect(
      updateManifestSchema.safeParse({
        latest_version_code: 10209,
      }).success,
    ).toBe(false);
    expect(
      updateManifestSchema.safeParse({
        latest_version: "1.2.9",
        latest_version_code: 10209,
        min_supported_version_code: 1,
        download_url: "ftp://cdn.example.com/apk",
      }).success,
    ).toBe(false);
  });
});

describe("webhookEventSchema", () => {
  test("accepts a Flutterwave-style event", () => {
    expect(
      webhookEventSchema.safeParse({
        event: "charge.success",
        data: {
          id: 4711,
          status: "successful",
          tx_ref: "ekwe-pro-123",
          customer: { email: "a@b.com" },
        },
        id: 4711,
      }).success,
    ).toBe(true);
  });

  test("accepts unknown extra keys (passthrough)", () => {
    expect(
      webhookEventSchema.safeParse({ event: "subscription.cancel", nope: {} })
        .success,
    ).toBe(true);
  });

  test("rejects a non-object payload", () => {
    expect(webhookEventSchema.safeParse("not-an-object").success).toBe(false);
    expect(webhookEventSchema.safeParse(42).success).toBe(false);
    expect(webhookEventSchema.safeParse(null).success).toBe(false);
  });
});

describe("synthesizeRequestSchema", () => {
  test("accepts a text-only body with a targetLang", () => {
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "en",
      }).success,
    ).toBe(true);
  });

  test("accepts an explicit sourceLang, gender, and voiceId", () => {
    const parsed = synthesizeRequestSchema.safeParse({
      text: "Hello",
      sourceLang: "fr",
      targetLang: "en",
      gender: "female",
      voiceId: "studio",
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts an unset gender so the provider supplies its default", () => {
    const parsed = synthesizeRequestSchema.safeParse({
      text: "Hello",
      targetLang: "en",
      voiceId: "studio",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.gender).toBeUndefined();
  });

  test("accepts the preview flag", () => {
    const parsed = synthesizeRequestSchema.safeParse({
      text: "Hello",
      targetLang: "en",
      isPreview: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.isPreview).toBe(true);
  });

  test("rejects a preview flag that is not true", () => {
    // Optional-and-literal, so `isPreview: false` and a forged `"yes"` cannot
    // pass a truthiness check downstream and quietly skip the quota.
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "en",
        isPreview: false,
      }).success,
    ).toBe(false);
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "en",
        isPreview: "yes",
      }).success,
    ).toBe(false);
  });

  test("bounds reroll so it cannot be used to mint a new cache entry per call", () => {
    // A timestamp is out of range, which is how a preview used to 400.
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "en",
        reroll: Date.now(),
      }).success,
    ).toBe(false);
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "en",
        reroll: 7,
      }).success,
    ).toBe(true);
  });

  test("rejects a voiceId that is not a slot", () => {
    const parsed = synthesizeRequestSchema.safeParse({
      text: "Hello",
      targetLang: "en",
      voiceId: "studio-female-1",
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts an auto sourceLang", () => {
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        sourceLang: "auto",
        targetLang: "en",
      }).success,
    ).toBe(true);
  });

  test("rejects a body missing targetLang", () => {
    expect(synthesizeRequestSchema.safeParse({ text: "Hello" }).success).toBe(
      false,
    );
  });

  test("rejects an empty or overlong text", () => {
    expect(
      synthesizeRequestSchema.safeParse({ text: "", targetLang: "en" }).success,
    ).toBe(false);
    expect(
      synthesizeRequestSchema.safeParse({
        text: "x".repeat(2401),
        targetLang: "en",
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown voiceId", () => {
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "en",
        voiceId: "not-a-voice",
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown language code", () => {
    expect(
      synthesizeRequestSchema.safeParse({
        text: "Hello",
        targetLang: "xx",
      }).success,
    ).toBe(false);
  });
});

describe("synthesizeResponseSchema", () => {
  test("accepts a minimal audio-url response", () => {
    const parsed = synthesizeResponseSchema.safeParse({
      audioUrl: "/speech/speech:abc:standard:auto:free:cache:en:def",
      mime: "audio/wav",
      sourceLang: "en",
      targetLang: "en",
      translated: false,
      voiceId: "standard",
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts a translated response with durationMs", () => {
    expect(
      synthesizeResponseSchema.safeParse({
        audioUrl: "/speech/speech:abc:standard:auto:free:cache:en:def",
        mime: "audio/wav",
        sourceLang: "fr",
        targetLang: "en",
        translated: true,
        voiceId: "studio",
        durationMs: 1240,
      }).success,
    ).toBe(true);
  });

  test("carries translationTruncated when the source was over budget", () => {
    const parsed = synthesizeResponseSchema.safeParse({
      audioUrl: "/speech/speech:abc:standard:auto:free:cache:en:def",
      mime: "audio/wav",
      sourceLang: "en",
      targetLang: "es",
      translated: true,
      voiceId: "standard",
      transcript: "the opening span",
      translation: "le début",
      translationTruncated: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.translationTruncated).toBe(true);
  });

  test("rejects a missing translated flag", () => {
    expect(
      synthesizeResponseSchema.safeParse({
        audioUrl: "/speech/speech:abc:standard:auto:free:cache:en:def",
        mime: "audio/wav",
        sourceLang: "en",
        targetLang: "en",
        voiceId: "standard",
      }).success,
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

  test("accepts any 3-letter code (unsupported ones resolve to USD server-side)", () => {
    expect(
      checkoutRequestSchema.safeParse({
        plan: "ekwe_pro_monthly",
        currency: "JOD",
      }).success,
    ).toBe(true);
  });
});

describe("checkoutResponseSchema", () => {
  test("accepts a valid checkout response with a public key", () => {
    expect(
      checkoutResponseSchema.safeParse({
        tx_ref: "ekwe_user_monthly_1234",
        amount: 19.2,
        currency: "USD",
        public_key: "FLWPUBK-xxx",
      }).success,
    ).toBe(true);
  });

  test("rejects a response missing tx_ref", () => {
    expect(
      checkoutResponseSchema.safeParse({
        amount: 19.2,
        currency: "USD",
        public_key: "FLWPUBK-xxx",
      }).success,
    ).toBe(false);
  });

  test("rejects a response missing amount", () => {
    expect(
      checkoutResponseSchema.safeParse({
        tx_ref: "ekwe_user_monthly_1234",
        currency: "USD",
        public_key: "FLWPUBK-xxx",
      }).success,
    ).toBe(false);
  });

  test("rejects a response missing the public key", () => {
    expect(
      checkoutResponseSchema.safeParse({
        tx_ref: "ekwe_user_monthly_1234",
        amount: 19.2,
        currency: "USD",
      }).success,
    ).toBe(false);
  });
});

describe("verifyTransactionRequestSchema", () => {
  test("accepts a positive integer transaction id", () => {
    expect(
      verifyTransactionRequestSchema.safeParse({ transaction_id: 288200108 })
        .success,
    ).toBe(true);
  });

  test("rejects non-numeric or non-integer ids", () => {
    expect(
      verifyTransactionRequestSchema.safeParse({ transaction_id: "abc" })
        .success,
    ).toBe(false);
    expect(
      verifyTransactionRequestSchema.safeParse({ transaction_id: 1.5 }).success,
    ).toBe(false);
  });

  test("rejects a zero or negative id", () => {
    expect(
      verifyTransactionRequestSchema.safeParse({ transaction_id: 0 }).success,
    ).toBe(false);
    expect(
      verifyTransactionRequestSchema.safeParse({ transaction_id: -1 }).success,
    ).toBe(false);
  });
});

describe("verifyTransactionResponseSchema", () => {
  test("accepts a successful verify response", () => {
    expect(
      verifyTransactionResponseSchema.safeParse({
        ok: true,
        permanent: false,
        transaction_id: 288200108,
        tx_ref: "ekwe_u_1_1",
      }).success,
    ).toBe(true);
  });
});

describe("billingFlagsResponseSchema", () => {
  test("accepts the flags shape", () => {
    expect(
      billingFlagsResponseSchema.safeParse({
        flutterwave_enabled: true,
        default_provider: "flutterwave",
      }).success,
    ).toBe(true);
  });
});

describe("registerPushTokenRequestSchema", () => {
  test("accepts a valid Expo push token", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[abcdefghijklmnopqrstuvwxyz012345]",
        platform: "android",
      }).success,
    ).toBe(true);
  });

  test("accepts an app_version", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[abcdefghijklmnopqrstuvwxyz012345]",
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
        push_token: "ExponentPushToken[abcdefghijklmnopqrstuvwxyz012345]",
        platform: "web",
      }).success,
    ).toBe(false);
  });

  test("rejects a bare prefix with no token body", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[]",
        platform: "android",
      }).success,
    ).toBe(false);
  });

  test("rejects an unterminated token", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "ExponentPushToken[abcdefghijklmnopqrstuvwxyz012345",
        platform: "android",
      }).success,
    ).toBe(false);
  });

  test("rejects a prefix smuggled past the start of the string", () => {
    expect(
      registerPushTokenRequestSchema.safeParse({
        push_token: "junkExponentPushToken[abcdefghijklmnopqrstuvwxyz012345]",
        platform: "android",
      }).success,
    ).toBe(false);
  });
});
