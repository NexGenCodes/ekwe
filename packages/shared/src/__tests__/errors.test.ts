import { describe, expect, it } from "vitest";

import {
  WORKER_ERROR_CODES,
  isWorkerErrorCode,
  type Tier,
  type UsageType,
} from "../errors";

describe("WORKER_ERROR_CODES", () => {
  it("maps every key to an identical value (no alias drift)", () => {
    for (const [key, value] of Object.entries(WORKER_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it("keeps codes unique (no two keys share a wire string)", () => {
    const values = Object.values(WORKER_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("contains every code the worker currently emits", () => {
    const expected = [
      "NOT_FOUND",
      "TOO_MANY_REQUESTS",
      "PAYLOAD_TOO_LARGE",
      "SERVER_ERROR",
      "SERVICE_UNAVAILABLE",
      "BAD_REQUEST",
      "INVALID_JSON",
      "INVALID_BODY",
      "INVALID_CONTENT_TYPE",
      "INVALID_EMAIL",
      "TURNSTILE_REQUIRED",
      "TURNSTILE_INVALID",
      "APP_CHECK_REQUIRED",
      "APP_CHECK_INVALID",
      "OTP_SEND_FAILED",
      "UNAUTHORIZED",
      "UNKNOWN_PROVIDER",
      "MISSING_FILE",
      "FILE_TOO_LARGE",
      "AUDIO_TOO_LONG",
      "INVALID_LANGUAGE",
      "AUTO_DETECT_UNAVAILABLE",
      "EKWE_EMPTY_TRANSCRIPT",
      "EKWE_TRANSCRIPTION_FAIL",
      "EKWE_ALL_PROVIDERS_FAIL",
      "INVALID_SOURCE_LANGUAGE",
      "INVALID_TARGET_LANGUAGE",
      "LANGUAGE_UNSUPPORTED",
      "MISSING_DURATION",
      "TEXT_TOO_LONG",
      "PREMIUM_FEATURE_REQUIRED",
      "SPEECH_UNAVAILABLE",

      "PAYMENT_INITIALIZATION_FAILED",
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "WEBHOOK_MISSING_HEADERS",
      "WEBHOOK_SIGNATURE_INVALID",
      "WEBHOOK_TIMESTAMP_EXPIRED",
      "STREAM_DURATION_EXCEEDED",
      "STREAM_PRO_ONLY",
      "CONFIG_TIMEOUT",
      "NO_PROVIDER_AVAILABLE",
      "TOO_MANY_CONNECTIONS",
      "USAGE_UNAVAILABLE",
      "EKWE_QUOTA_EXCEEDED",
      "EKWE_RATE_LIMIT",
      "EKWE_SERVER_ERROR",
    ];
    expect(Object.values(WORKER_ERROR_CODES).sort()).toEqual(expected.sort());
  });

  it("does not include client-only codes", () => {
    const values: Set<string> = new Set(Object.values(WORKER_ERROR_CODES));
    for (const clientOnly of [
      "EKWE_NETWORK_LOST",
      "EKWE_SHARE_COPY_FAIL",
      "EKWE_TRANSCRIBE_TIMEOUT",
      "EKWE_TRANSLATION_FAIL",
      "EKWE_FILE_TOO_LARGE",
      "EKWE_RATE_LIMITED",
      "EKWE_TTS_FAIL",
    ]) {
      expect(values.has(clientOnly)).toBe(false);
    }
  });
});

describe("isWorkerErrorCode", () => {
  it("returns true for known codes and false otherwise", () => {
    expect(isWorkerErrorCode(WORKER_ERROR_CODES.FILE_TOO_LARGE)).toBe(true);
    expect(isWorkerErrorCode("EKWE_QUOTA_EXCEEDED")).toBe(true);
    expect(isWorkerErrorCode("EKWE_BOGUS")).toBe(false);
    expect(isWorkerErrorCode("EKWE_RATE_LIMITED")).toBe(false);
  });
});

describe("Tier / UsageType", () => {
  it("types are the exact unions the app relies on", () => {
    const tier: Tier[] = ["PREMIUM", "FREE"];
    const usage: UsageType[] = ["translate", "transcribe"];
    expect(tier).toEqual(["PREMIUM", "FREE"]);
    expect(usage).toEqual(["translate", "transcribe"]);
  });
});
