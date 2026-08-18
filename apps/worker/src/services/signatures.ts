import { logger } from "../core/logger";
import { hexEncode } from "../utils/keys";

export type WebhookProvider = "flutterwave" | "unknown";

interface WebhookVerificationResult {
  isValid: boolean;
  provider: WebhookProvider;
  error?: string;
}

// ─── HMAC Timestamp Freshness ────────────────────────────────────
// Maximum age (in seconds) for a webhook timestamp before we reject it.
// Prevents replay attacks where an attacker captures a valid signed payload
// and re-submits it minutes/hours later.
const TIMESTAMP_FRESHNESS_SECONDS = 300; // 5 minutes

/**
 * Computes an HMAC signature using the Web Crypto API
 */
async function computeHMAC(
  secret: string,
  payload: string,
  algorithm: "SHA-256" | "SHA-512",
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );

  return hexEncode(signatureBuffer);
}

/**
 * Timing-safe string comparison using SHA-256 hashing to avoid leaking the
 * expected value length via timing side-channel.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const aBuf = new Uint8Array(hashA);
  const bBuf = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

/**
 * Checks whether a unix timestamp (in seconds) is within the allowed freshness
 * window. Rejects replay attacks where captured payloads are re-submitted.
 */
function isTimestampFresh(timestampSec: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - timestampSec);
  return age <= TIMESTAMP_FRESHNESS_SECONDS;
}

// ─── Provider Detection & Verification ───────────────────────────

export async function verifyWebhook(
  request: Request,
  rawBody: string,
  env: {
    FLUTTERWAVE_SECRET?: string;
    [key: string]: unknown;
  },
): Promise<WebhookVerificationResult> {
  const headers = request.headers;

  // ── FLUTTERWAVE (HMAC-SHA512) ──
  // Flutterwave sends:
  //   X-Flutterwave-Signature: SHA512(<secret><timestamp><body>)
  // where <timestamp> is the request timestamp and <body> is the raw JSON.
  const flutterwaveSig = headers.get("x-flutterwave-signature");
  const flutterwaveTimestamp = headers.get("x-flutterwave-timestamp");
  if (flutterwaveSig) {
    if (!env.FLUTTERWAVE_SECRET) {
      logger.error("Missing FLUTTERWAVE_SECRET in environment");
      return {
        isValid: false,
        provider: "flutterwave",
        error: "Server misconfiguration",
      };
    }

    // Reject if timestamp is stale
    if (flutterwaveTimestamp) {
      const tsNum = parseInt(flutterwaveTimestamp, 10);
      if (!Number.isFinite(tsNum) || !isTimestampFresh(tsNum)) {
        logger.warn("[webhook] Flutterwave timestamp too old", {
          timestamp: flutterwaveTimestamp,
        });
        return {
          isValid: false,
          provider: "flutterwave",
          error: "Timestamp expired",
        };
      }
    }

    // Flutterwave signs: SHA512(secret + timestamp + body)
    const payload = `${env.FLUTTERWAVE_SECRET}${flutterwaveTimestamp || ""}${rawBody}`;
    const computed = await computeHMAC(env.FLUTTERWAVE_SECRET, payload, "SHA-512");
    const isValid = await timingSafeEqual(computed, flutterwaveSig);
    if (!isValid) logger.warn("[webhook] Flutterwave signature mismatch");
    return { isValid, provider: "flutterwave" };
  }

  // ── UNKNOWN PROVIDER ──
  logger.warn("[webhook] Request missing valid webhook signature headers");
  return {
    isValid: false,
    provider: "unknown",
    error: "Missing signature headers",
  };
}
