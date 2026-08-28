/**
 * ─── Worker Wire Error Contract ─────────────────────────────────
 *
 * Every error code the Ekwe worker can emit in a `{ error: "<CODE>" }`
 * response body. The worker emits via these constants and the mobile app
 * matches against them, so a typo or rename on either side fails typecheck
 * instead of silently drifting (historically the two sides disagreed on
 * `EKWE_RATE_LIMIT` vs `EKWE_RATE_LIMITED`, and mobile matched
 * `EKWE_FILE_TOO_LARGE` while the worker always emitted `FILE_TOO_LARGE`).
 *
 * Codes the client produces itself (NETWORK_LOST, SHARE_COPY_FAIL,
 * TRANSCRIBE_TIMEOUT, etc.) are intentionally NOT here — they never cross the
 * wire and live in the app's own error taxonomy.
 */

export const WORKER_ERROR_CODES = {
  // Router / transport
  NOT_FOUND: "NOT_FOUND",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  SERVER_ERROR: "SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  BAD_REQUEST: "BAD_REQUEST",
  INVALID_JSON: "INVALID_JSON",
  INVALID_BODY: "INVALID_BODY",
  INVALID_CONTENT_TYPE: "INVALID_CONTENT_TYPE",

  // Auth / OTP
  INVALID_EMAIL: "INVALID_EMAIL",
  TURNSTILE_REQUIRED: "TURNSTILE_REQUIRED",
  TURNSTILE_INVALID: "TURNSTILE_INVALID",
  OTP_SEND_FAILED: "OTP_SEND_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",

  // Webhooks
  UNKNOWN_PROVIDER: "UNKNOWN_PROVIDER",

  // Transcription
  MISSING_FILE: "MISSING_FILE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  AUDIO_TOO_LONG: "AUDIO_TOO_LONG",
  INVALID_LANGUAGE: "INVALID_LANGUAGE",
  AUTO_DETECT_UNAVAILABLE: "AUTO_DETECT_UNAVAILABLE",
  EKWE_EMPTY_TRANSCRIPT: "EKWE_EMPTY_TRANSCRIPT",
  EKWE_TRANSCRIPTION_FAIL: "EKWE_TRANSCRIPTION_FAIL",
  EKWE_ALL_PROVIDERS_FAIL: "EKWE_ALL_PROVIDERS_FAIL",

  // Translation / TTS
  INVALID_SOURCE_LANGUAGE: "INVALID_SOURCE_LANGUAGE",
  INVALID_TARGET_LANGUAGE: "INVALID_TARGET_LANGUAGE",
  TEXT_TOO_LONG: "TEXT_TOO_LONG",
  PREMIUM_FEATURE_REQUIRED: "PREMIUM_FEATURE_REQUIRED",
  TTS_UNAVAILABLE: "TTS_UNAVAILABLE",

  // Live streaming
  STREAM_DURATION_EXCEEDED: "STREAM_DURATION_EXCEEDED",
  STREAM_PRO_ONLY: "STREAM_PRO_ONLY",
  CONFIG_TIMEOUT: "CONFIG_TIMEOUT",
  NO_PROVIDER_AVAILABLE: "NO_PROVIDER_AVAILABLE",
  TOO_MANY_CONNECTIONS: "TOO_MANY_CONNECTIONS",

  // Billing / payment providers
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
  WEBHOOK_TIMESTAMP_EXPIRED: "WEBHOOK_TIMESTAMP_EXPIRED",
  WEBHOOK_MISSING_HEADERS: "WEBHOOK_MISSING_HEADERS",
  PAYMENT_PROVIDER_UNAVAILABLE: "PAYMENT_PROVIDER_UNAVAILABLE",
  PAYMENT_INITIALIZATION_FAILED: "PAYMENT_INITIALIZATION_FAILED",

  // Usage / quota (client taxonomy: the EKWE_* prefix is what the app maps
  // to a user-facing message, distinct from the transport codes above).
  USAGE_UNAVAILABLE: "USAGE_UNAVAILABLE",
  EKWE_QUOTA_EXCEEDED: "EKWE_QUOTA_EXCEEDED",
  EKWE_RATE_LIMIT: "EKWE_RATE_LIMIT",
  EKWE_SERVER_ERROR: "EKWE_SERVER_ERROR",
} as const;

export type WorkerErrorCode =
  (typeof WORKER_ERROR_CODES)[keyof typeof WORKER_ERROR_CODES];

export function isWorkerErrorCode(code: string): code is WorkerErrorCode {
  return (Object.values(WORKER_ERROR_CODES) as string[]).includes(code);
}

/** The app's two plan tiers. `"FREE"` = the 25/day quota plan, `"PREMIUM"` = Pro. */
export type Tier = "PREMIUM" | "FREE";

/** Request types that draw down the user's daily usage quota. */
export type UsageType = "translate" | "transcribe" | "tts";
