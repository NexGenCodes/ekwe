import { WORKER_ERROR_CODES } from "@ekwe/shared";
import type { WebhookVerificationResult } from "@ekwe/shared";
import { logger } from "../core/logger";
import { hexEncode } from "../utils/keys";

/**
 * Computes an HMAC signature using the Web Crypto API.
 * Returns the signature hex-encoded, or base64-encoded when `encoding` is
 * set to "base64".
 */
async function computeHMAC(
  secret: string,
  payload: string,
  algorithm: "SHA-256" | "SHA-512",
  encoding: "hex" | "base64" = "hex",
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

  if (encoding === "base64") {
    const bytes = new Uint8Array(signatureBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

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

// ─── Provider Detection & Verification ───────────────────────────

export async function verifyWebhook(
  request: Request,
  rawBody: string,
  env: {
    FLUTTERWAVE_WEBHOOK_SECRET?: string;
    [key: string]: unknown;
  },
): Promise<WebhookVerificationResult> {
  const headers = request.headers;

  // ── FLUTTERWAVE ──
  // Flutterwave sends two verification mechanisms (both supported):
  //   1. `verif-hash` header — the plain secret hash configured on the
  //      dashboard (V3 webhooks). Verified via timing-safe equality.
  //   2. `flutterwave-signature` header — HMAC-SHA256 over the raw request
  //      body, base64-encoded, keyed with the secret hash.
  const verifHash = headers.get("verif-hash");
  const flutterwaveSig = headers.get("flutterwave-signature");

  if (verifHash || flutterwaveSig) {
    if (!env.FLUTTERWAVE_WEBHOOK_SECRET) {
      logger.error("Missing FLUTTERWAVE_WEBHOOK_SECRET in environment");
      return {
        isValid: false,
        provider: "flutterwave",
        error: "Server misconfiguration",
        code: WORKER_ERROR_CODES.SERVER_ERROR,
      };
    }

    let isValid = false;

    // Mechanism 1: plain verif-hash equality
    if (verifHash) {
      isValid = await timingSafeEqual(verifHash, env.FLUTTERWAVE_WEBHOOK_SECRET);
    }

    // Mechanism 2: HMAC-SHA256 over the raw body (base64-encoded)
    if (!isValid && flutterwaveSig) {
      const computed = await computeHMAC(
        env.FLUTTERWAVE_WEBHOOK_SECRET,
        rawBody,
        "SHA-256",
        "base64",
      );
      isValid = await timingSafeEqual(computed, flutterwaveSig);
    }

    if (!isValid) {
      logger.warn("[webhook] Flutterwave signature mismatch");
      return {
        isValid: false,
        provider: "flutterwave",
        error: "Signature mismatch",
        code: WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      };
    }
    return { isValid, provider: "flutterwave" };
  }

  // ── UNKNOWN PROVIDER ──
  logger.warn("[webhook] Request missing valid webhook signature headers");
  return {
    isValid: false,
    provider: "unknown",
    error: "Missing signature headers",
    code: WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS,
  };
}
