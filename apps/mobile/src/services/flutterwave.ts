/**
 * ─── Flutterwave Service ─────────────────────────────────────────
 *
 * Handles Flutterwave payments on mobile via the official
 * flutterwave-react-native-sdk (modal checkout), instead of a hand-rolled
 * WebView over a server-generated payment link.
 *
 * The flow:
 *
 *   1. Mobile calls POST /billing/checkout on the Worker
 *   2. Worker authorizes a checkout session — { tx_ref, amount, currency } —
 *      priced server-side from subscription_config local_prices
 *   3. Mobile initializes the payment with the SDK using the session params
 *      plus the merchant public key (EXPO_PUBLIC_FLUTTERWAVE_PUBLIC_KEY)
 *   4. User completes payment in the SDK's in-app modal
 *   5. SDK redirects to rn-redirect → mobile notifies the caller
 *   6. Worker receives the webhook → calls set_pro_status RPC
 *   7. Mobile polls for Pro status via session refresh
 *
 * This service is intentionally minimal — the heavy lifting (webhook
 * verification, RPC calls, idempotency) lives in the Worker.
 */

import { PRO_PRODUCT_IDS } from "@ekwe/shared/plans";
import {
  checkoutResponseSchema,
  verifyTransactionResponseSchema,
  type CheckoutRequest,
  type CheckoutResponse,
} from "@ekwe/shared";
import { z } from "zod";
import { supabase } from "@/services/supabase";
import { auth$ } from "@/store";
import { settings$ } from "@/store";
import { getWorkerUrl } from "@/utils/networkUtils";
import logger from "@/utils/logger";

// ─── Configuration ───────────────────────────────────────────────

const CHECKOUT_PATH = "/billing/checkout";
const VERIFY_TRANSACTION_PATH = "/billing/verify-transaction";
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 2500;

// ─── Types ───────────────────────────────────────────────────────

/** The worker's checkout session, typed from the shared schema. */
export type CheckoutSession = CheckoutResponse;

export interface CheckoutOutcome {
  /** User closed the sheet without completing payment. */
  canceled: boolean;
  /** The worker-authorized checkout session to feed the SDK. */
  session: CheckoutSession | null;
}

export type VerifyTransactionResponse = z.infer<
  typeof verifyTransactionResponseSchema
>;

// ─── Helpers ─────────────────────────────────────────────────────

function getWorkerBaseUrl(): string {
  const url = getWorkerUrl();
  if (!url) {
    throw new Error(
      "Billing service is temporarily unavailable. Please check your connection and try again.",
    );
  }
  return url;
}

/**
 * The merchant public key used to initialize the SDK checkout client-side.
 * It is a publishable key (not a secret), safe to ship in the bundle.
 */
export function getFlutterwavePublicKey(): string {
  return process.env.EXPO_PUBLIC_FLUTTERWAVE_PUBLIC_KEY ?? "";
}

/**
 * Maps a billing toggle selection (annual/monthly) to the correct
 * Flutterwave plan identifier. Used as tx_ref metadata so the webhook can
 * identify the plan.
 */
export function getFlutterwavePlanId(
  isAnnual: boolean,
): (typeof PRO_PRODUCT_IDS)["monthly"] | (typeof PRO_PRODUCT_IDS)["annual"] {
  return isAnnual ? PRO_PRODUCT_IDS.annual : PRO_PRODUCT_IDS.monthly;
}

// ─── API Calls ───────────────────────────────────────────────────

/**
 * Authorize a checkout session with the Worker. The Worker is
 * server-authoritative for pricing, currency, and the unique tx_ref; the
 * SDK initializes the actual payment with these params + the public key.
 */
async function initializeCheckout(isAnnual: boolean): Promise<CheckoutSession> {
  const session = auth$.session.get();
  if (!session) throw new Error("Authentication required");

  const manual = settings$.currency.peek();
  const body: CheckoutRequest = {
    plan: getFlutterwavePlanId(isAnnual),
    // Only send a currency when the user picked one manually; otherwise omit
    // it so the worker resolves the currency authoritatively from the request
    // geo (Cloudflare CF-IPCountry). Trusting the server avoids the Android
    // locale quirk that misreports region (e.g. an English-US phone in
    // Nigeria resolving to USD).
    ...(manual ? { currency: manual } : {}),
  };

  const res = await fetch(`${getWorkerBaseUrl()}${CHECKOUT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error(
      "[Flutterwave] Checkout init failed",
      JSON.stringify({ status: res.status, body: body.slice(0, 200) }),
    );
    throw new Error("Failed to initialize payment. Please try again.");
  }

  const raw = await res.json();
  const parsed = checkoutResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error(
      "[Flutterwave] Checkout response shape mismatch",
      JSON.stringify({ issues: parsed.error.issues, rawBody: raw }),
    );
    throw new Error("Failed to initialize payment. Please try again.");
  }
  const data = parsed.data;
  logger.info("[Flutterwave] Checkout session authorized", {
    tx_ref: data.tx_ref,
  });
  return data;
}

/**
 * Client-side verification endpoint. After the SDK reports a successful
 * payment (status + transaction_id), the client calls this endpoint to
 * have the Worker verify it with Flutterwave and grant Pro via RPC.
 * This is the primary activation path — webhooks are the fallback.
 */
export async function verifyTransaction(
  transactionId: number,
): Promise<VerifyTransactionResponse> {
  const session = auth$.session.get();
  if (!session) throw new Error("Authentication required");

  const res = await fetch(`${getWorkerBaseUrl()}${VERIFY_TRANSACTION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ transaction_id: transactionId }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("[Flutterwave] Verify transaction failed", {
      status: res.status,
      body: body.slice(0, 200),
    });
    throw new Error("Failed to verify payment");
  }

  const raw = await res.json();
  const parsed = verifyTransactionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error("[Flutterwave] Verify response shape mismatch", {
      issues: parsed.error.issues,
      rawBody: raw,
    });
    throw new Error("Failed to verify payment");
  }
  return parsed.data;
}

/**
 * Polls the Supabase user_subscriptions table for Pro status after a
 * Flutterwave payment. The webhook processes asynchronously, so we poll
 * for the same duration as the original reconcileProStatus.
 */
async function pollForProStatus(): Promise<boolean> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const { data: sessionData, error } = await supabase.auth.refreshSession();
    if (error) throw error;

    if (sessionData.session?.user?.app_metadata?.is_pro === true) {
      return true;
    }

    if (attempt < POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  return false;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Authorize a Pro checkout session for the SDK. Returns the worker's
 * session params (tx_ref, amount, currency) so the caller can render the
 * SDK checkout. Does NOT open the modal — the caller renders the sheet.
 *
 * The actual Pro activation happens via webhook, not immediately. After
 * the sheet is dismissed, the caller should poll for Pro status.
 */
export async function openFlutterwaveCheckout(
  isAnnual: boolean,
): Promise<CheckoutOutcome> {
  try {
    const session = await initializeCheckout(isAnnual);

    logger.info("[Flutterwave] Checkout session received", {
      tx_ref: session.tx_ref,
    });

    return {
      canceled: false,
      session,
    };
  } catch (err) {
    logger.error("[Flutterwave] Checkout failed", err);
    throw new Error(
      "Payment could not be started. Please check your connection.",
    );
  }
}

/**
 * After a Flutterwave checkout, poll for Pro status. Should be called
 * only when the checkout was not canceled (or the user might have completed
 * payment before the sheet closed).
 */
export async function reconcileFlutterwaveStatus(): Promise<boolean> {
  return pollForProStatus();
}

/**
 * Check if Flutterwave is available on this device. Requires a valid
 * session. The SDK's public key is now server-authoritative (returned in
 * the checkout response), so availability is decided by the worker's own
 * key guard at checkout time rather than by a client-side env var.
 */
export function isFlutterwaveAvailable(): boolean {
  return !!auth$.session.get();
}
