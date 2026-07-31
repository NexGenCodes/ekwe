import { logger } from "./logger";
import { hexEncode } from "./utils/keys";

export type WebhookProvider =
  "paystack" | "flutterwave" | "revenuecat" | "unknown";

export interface WebhookVerificationResult {
  isValid: boolean;
  provider: WebhookProvider;
  error?: string;
}

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
 * Unified Webhook Signature Verifier
 *
 * Analyzes the headers to determine the provider, then computes
 * the appropriate cryptographic signature (or hash match) to verify
 * the authenticity of the webhook payload.
 *
 * Uses SHA-256 hashing before comparison to avoid leaking the expected
 * value length via timing side-channel.
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

export async function verifyWebhook(
  request: Request,
  rawBody: string,
  env: {
    PAYSTACK_SECRET_KEY?: string;
    FLUTTERWAVE_SECRET_HASH?: string;
    REVENUECAT_WEBHOOK_SECRET?: string;
    [key: string]: unknown;
  },
): Promise<WebhookVerificationResult> {
  const headers = request.headers;

  // ── 1. PAYSTACK (HMAC-SHA512) ──
  const paystackSig = headers.get("x-paystack-signature");
  if (paystackSig) {
    if (!env.PAYSTACK_SECRET_KEY) {
      logger.error("Missing PAYSTACK_SECRET_KEY in environment");
      return {
        isValid: false,
        provider: "paystack",
        error: "Server misconfiguration",
      };
    }
    const computed = await computeHMAC(
      env.PAYSTACK_SECRET_KEY,
      rawBody,
      "SHA-512",
    );
    const isValid = await timingSafeEqual(computed, paystackSig);
    if (!isValid) logger.warn("[webhook] Paystack signature mismatch");
    return { isValid, provider: "paystack" };
  }

  // ── 2. FLUTTERWAVE (Secret Hash Match) ──
  const flutterwaveSig = headers.get("verif-hash");
  if (flutterwaveSig) {
    if (!env.FLUTTERWAVE_SECRET_HASH) {
      logger.error("Missing FLUTTERWAVE_SECRET_HASH in environment");
      return {
        isValid: false,
        provider: "flutterwave",
        error: "Server misconfiguration",
      };
    }
    const isValid = await timingSafeEqual(
      flutterwaveSig,
      env.FLUTTERWAVE_SECRET_HASH,
    );
    if (!isValid) logger.warn("[webhook] Flutterwave signature mismatch");
    return { isValid, provider: "flutterwave" };
  }

  // ── 3. REVENUECAT (HMAC-SHA256) ──
  // Note: RevenueCat supports Apple/Google Play unified webhooks
  const revenueCatSig = headers.get("x-revenuecat-signature");
  if (revenueCatSig) {
    if (!env.REVENUECAT_WEBHOOK_SECRET) {
      logger.error("Missing REVENUECAT_WEBHOOK_SECRET in environment");
      return {
        isValid: false,
        provider: "revenuecat",
        error: "Server misconfiguration",
      };
    }
    const computed = await computeHMAC(
      env.REVENUECAT_WEBHOOK_SECRET,
      rawBody,
      "SHA-256",
    );
    const isValid = await timingSafeEqual(computed, revenueCatSig);
    if (!isValid) logger.warn("[webhook] RevenueCat signature mismatch");
    return { isValid, provider: "revenuecat" };
  }

  // ── UNKNOWN PROVIDER ──
  logger.warn("[webhook] Request missing valid webhook signature headers");
  return {
    isValid: false,
    provider: "unknown",
    error: "Missing signature headers",
  };
}
