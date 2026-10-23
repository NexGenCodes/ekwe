import { PRO_PRODUCT_IDS } from "@ekwe/shared/plans";
import {
  checkoutResponseSchema,
  verifyTransactionResponseSchema,
  type CheckoutRequest,
  type CheckoutResponse,
} from "@ekwe/shared";
import { z } from "zod";

import { apiJson } from "@/services/backend";
import { fetchSessionUser } from "@/services/auth";
import { auth$ } from "@/store";
import { settings$ } from "@/store";
import logger from "@/utils/logger";

const CHECKOUT_PATH = "/billing/checkout";
const VERIFY_TRANSACTION_PATH = "/billing/verify-transaction";
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 2500;

export type CheckoutSession = CheckoutResponse;

export interface CheckoutOutcome {
  canceled: boolean;
  session: CheckoutSession | null;
}

export type VerifyTransactionResponse = z.infer<
  typeof verifyTransactionResponseSchema
>;

export function getFlutterwavePlanId(
  isAnnual: boolean,
): (typeof PRO_PRODUCT_IDS)["monthly"] | (typeof PRO_PRODUCT_IDS)["annual"] {
  return isAnnual ? PRO_PRODUCT_IDS.annual : PRO_PRODUCT_IDS.monthly;
}

async function initializeCheckout(isAnnual: boolean): Promise<CheckoutSession> {
  const body: CheckoutRequest = {
    plan: getFlutterwavePlanId(isAnnual),
    currency: settings$.currency.peek(),
  };

  const raw = await apiJson(CHECKOUT_PATH, { method: "POST", body });
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

export async function verifyTransaction(
  transactionId: number,
): Promise<VerifyTransactionResponse> {
  const raw = await apiJson(VERIFY_TRANSACTION_PATH, {
    method: "POST",
    body: { transaction_id: transactionId },
  });
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
 * The worker writes the new tier to D1 before the verify response lands, so the
 * session endpoint already reports PREMIUM. Polling covers a payment confirmed
 * by webhook slightly after checkout closed.
 */
async function pollForProStatus(): Promise<boolean> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const user = await fetchSessionUser();
    if (user?.tier === "PREMIUM") return true;

    if (attempt < POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  return false;
}

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
    logger.warn("[Flutterwave] Checkout failed", err);
    throw new Error(
      "Payment could not be started. Please check your connection.",
    );
  }
}

export async function reconcileFlutterwaveStatus(): Promise<boolean> {
  return pollForProStatus();
}

export function isFlutterwaveAvailable(): boolean {
  return !!auth$.session.peek();
}
