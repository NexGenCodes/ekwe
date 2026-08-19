/**
 * ─── Flutterwave Service ─────────────────────────────────────────
 *
 * Handles Flutterwave payments on mobile. Checkout happens in an
 * in-app WebView sheet.
 * The flow:
 *
 *   1. Mobile calls POST /billing/checkout on the Worker
 *   2. Worker creates a Flutterwave payment link with metadata
 *   3. Mobile renders the checkout URL in an in-app WebView sheet
 *   4. User completes payment on Flutterwave's hosted page
 *   5. Flutterwave redirects to the SDK's monitored URL (rn-redirect)
 *   6. Worker receives the webhook → calls set_pro_status RPC
 *   7. Mobile polls for Pro status via session refresh
 *
 * This service is intentionally minimal — the heavy lifting (webhook
 * verification, RPC calls, idempotency) lives in the Worker.
 */

import { PRO_PRODUCT_IDS } from "@ekwe/shared/plans";
import {
  checkoutResponseSchema,
  type CheckoutRequest,
  type CheckoutResponse,
} from "@ekwe/shared";
import { detectDeviceCurrency } from "@/constants/currency";
import { supabase } from "@/services/supabase";
import { auth$ } from "@/store";
import { getWorkerUrl } from "@/utils/networkUtils";
import logger from "@/utils/logger";

// ─── Configuration ───────────────────────────────────────────────

const CHECKOUT_PATH = "/billing/checkout";
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 2500;

// ─── Types ───────────────────────────────────────────────────────

/** The worker's checkout response, typed from the shared schema. */
export type CheckoutSession = CheckoutResponse;

export interface CheckoutOutcome {
  /** User closed the sheet without completing payment. */
  canceled: boolean;
  /** The checkout URL to render in the WebView sheet. */
  checkoutUrl: string;
  /** The transaction reference if payment was initiated. */
  txRef: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Worker base URL from the canonical source (EXPO_PUBLIC_WORKER_URL). */
function getWorkerBaseUrl(): string {
  return getWorkerUrl();
}

/**
 * Maps a billing toggle selection (annual/monthly) to the correct
 * Flutterwave plan identifier. Uses the product IDs as tx_ref metadata so
 * the webhook can identify the plan.
 */
function getFlutterwavePlanId(
  isAnnual: boolean,
): (typeof PRO_PRODUCT_IDS)["monthly"] | (typeof PRO_PRODUCT_IDS)["annual"] {
  return isAnnual ? PRO_PRODUCT_IDS.annual : PRO_PRODUCT_IDS.monthly;
}

// ─── API Calls ───────────────────────────────────────────────────

/**
 * Initialize a Flutterwave checkout session. The Worker creates the
 * payment link with the correct amount, currency, and metadata.
 */
async function initializeCheckout(
  isAnnual: boolean,
): Promise<CheckoutSession> {
  const session = auth$.session.get();
  if (!session) throw new Error("Authentication required");

  const body: CheckoutRequest = {
    plan: getFlutterwavePlanId(isAnnual),
    currency: detectDeviceCurrency(),
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
    logger.error("[Flutterwave] Checkout init failed", {
      status: res.status,
      body: body.slice(0, 200),
    });
    throw new Error("Failed to initialize payment. Please try again.");
  }

  const parsed = checkoutResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error("[Flutterwave] Checkout response shape mismatch", {
      issues: parsed.error.issues,
    });
    throw new Error("Failed to initialize payment. Please try again.");
  }
  const data = parsed.data;
  logger.info("[Flutterwave] Checkout initialized", { tx_ref: data.tx_ref });
  return data;
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
 * Open Flutterwave checkout for a Pro subscription. Returns the
 * checkout URL to render in a WebView sheet, plus the tx_ref for
 * tracking. Does NOT open a browser — the caller renders the sheet.
 *
 * The actual Pro activation happens via webhook, not immediately. After
 * the sheet is dismissed, the caller should poll for Pro status.
 */
export async function openFlutterwaveCheckout(
  isAnnual: boolean,
): Promise<CheckoutOutcome> {
  try {
    const { checkout_url, tx_ref } = await initializeCheckout(isAnnual);

    logger.info("[Flutterwave] Checkout URL received", { tx_ref });

    return {
      canceled: false,
      checkoutUrl: checkout_url,
      txRef: tx_ref,
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
 * Check if Flutterwave is available on this device. Flutterwave checkout
 * works on all platforms (web-based), but we need a valid session and
 * network connection.
 */
export function isFlutterwaveAvailable(): boolean {
  return !!auth$.session.get();
}
