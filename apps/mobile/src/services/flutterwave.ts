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
import { getWorkerUrl } from "@/utils/http";
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

function getWorkerBaseUrl(): string {
  const url = getWorkerUrl();
  if (!url) {
    throw new Error(
      "Billing service is temporarily unavailable. Please check your connection and try again.",
    );
  }
  return url;
}

export function getFlutterwavePublicKey(): string {
  return process.env.EXPO_PUBLIC_FLUTTERWAVE_PUBLIC_KEY ?? "";
}

export function getFlutterwavePlanId(
  isAnnual: boolean,
): (typeof PRO_PRODUCT_IDS)["monthly"] | (typeof PRO_PRODUCT_IDS)["annual"] {
  return isAnnual ? PRO_PRODUCT_IDS.annual : PRO_PRODUCT_IDS.monthly;
}

async function initializeCheckout(isAnnual: boolean): Promise<CheckoutSession> {
  const session = auth$.session.get();
  if (!session) throw new Error("Authentication required");

  const manual = settings$.currency.peek();
  const body: CheckoutRequest = {
    plan: getFlutterwavePlanId(isAnnual),
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
  return !!auth$.session.get();
}
