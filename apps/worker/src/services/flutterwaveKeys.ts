/**
 * ─── Flutterwave Key Environment Safety ──────────────────────────
 *
 * Flutterwave's Live/Test mode is selected by the key prefix, not the API
 * host: test keys start `FLWSECK_TEST-` / `FLWPUBK_TEST-`, live keys do not.
 * A payout/payment integrated with test keys is only billable against the
 * test sandbox — if that configuration ever reaches a production deploy, a
 * tester could "pay" with a fake test card and be granted Pro for free (the
 * verify-transaction route would see a successful sandbox charge).
 *
 * This module fails CLOSED: in a production deployment a test-prefixed key
 * is treated as a misconfiguration and the payment surface is disabled. In
 * development/test environments (APP_ENV !== "production") test keys remain
 * fully usable so the whole checkout → webhook → Pro-grant flow can be
 * exercised before going live.
 */

import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "../core/logger";

const TEST_SECRET_PREFIX = "FLWSECK_TEST-";
const TEST_PUBLIC_PREFIX = "FLWPUBK_TEST-";

export function isTestSecretKey(key: string | undefined): boolean {
  return !!key?.startsWith(TEST_SECRET_PREFIX);
}

export function isTestPublicKey(key: string | undefined): boolean {
  return !!key?.startsWith(TEST_PUBLIC_PREFIX);
}

export interface FlutterwaveKeyGuard {
  /** True when the payment surface may operate with the configured keys. */
  allowed: boolean;
  /** Response to return when not allowed. */
  response: Response;
}

/**
 * Returns a fail-closed guard for the current deployment. In production a
 * test-prefixed secret or public key (or a missing live key) disables
 * checkout/verification; elsewhere the configured keys are accepted.
 */
export function guardFlutterwaveKeys(env: {
  APP_ENV?: string;
  FLUTTERWAVE_SECRET?: string;
  FLUTTERWAVE_PUBLIC?: string;
}): FlutterwaveKeyGuard {
  const isProduction = env.APP_ENV === "production";

  const reject = (why: string): FlutterwaveKeyGuard => {
    logger.error(`[flutterwave] Rejected payment keys in production: ${why}`);
    return {
      allowed: false,
      response: Response.json(
        { error: WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE },
        { status: 503 },
      ),
    };
  };

  if (isProduction) {
    if (!env.FLUTTERWAVE_SECRET) {
      return reject("secret key missing");
    }
    if (isTestSecretKey(env.FLUTTERWAVE_SECRET)) {
      return reject(
        "secret key is TEST-prefixed (FLWSECK_TEST-) — set a live key",
      );
    }
    if (!env.FLUTTERWAVE_PUBLIC) {
      return reject("public key missing");
    }
    if (isTestPublicKey(env.FLUTTERWAVE_PUBLIC)) {
      return reject(
        "public key is TEST-prefixed (FLWPUBK_TEST-) — set a live key",
      );
    }
  }

  return {
    allowed: true,
    response: Response.json({}),
  };
}
