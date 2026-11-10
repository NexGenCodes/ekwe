import {
  APP_VERSION,
  WORKER_ERROR_CODES,
  PRO_PRODUCT_IDS,
  checkoutRequestSchema,
  checkoutResponseSchema,
  verifyTransactionRequestSchema,
  verifyTransactionResponseSchema,
} from "@ekwe/shared";
import { toLowestUnit } from "@ekwe/shared/money";
import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import {
  ensureProCoverage,
  guardFlutterwaveKeys,
  setProStatus,
} from "@/services/flutterwave";
import { claimFlutterwaveTransaction } from "@/services/flutterwave-claim";
import { AuthResult } from "@/core/auth";
import { describeError, retryTransient } from "@/db/retry";
import {
  getAuthoritativePlanPrices,
  resolveRequestCurrency,
} from "@/routes/pricing";
import type { z } from "zod";

// ── Flutterwave verify response shape ─────────────────────────────────────────
interface FlutterwaveVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    status: string;
    amount: number;
    currency: string;
    customer: {
      id: number;
      name: string;
      email: string;
      phone_number: string | null;
    };
  };
}

// ── Billing endpoint constants ────────────────────────────────────────────────
const FLUTTERWAVE_PAYMENTS_PATH = "https://api.flutterwave.com/v3/payments";
const CHECKOUT_REDIRECT_URL = "https://www.ekwe.app";
const VERIFY_TRANSACTION_PATH =
  "https://api.flutterwave.com/v3/transactions/{id}/verify";
const FLUTTERWAVE_USER_AGENT = `Ekwe-Worker/${APP_VERSION} (https://ekwe.app)`;

export async function handleCheckout(
  body: z.infer<typeof checkoutRequestSchema>,
  env: Env,
  auth: AuthResult,
): Promise<Response> {
  const currency = resolveRequestCurrency(body.currency);

  const keyGuard = guardFlutterwaveKeys(env);
  if (!keyGuard.allowed) return keyGuard.response;

  const prices = await getAuthoritativePlanPrices(env, currency);
  if (!prices) {
    logger.warn("[billing/checkout] Cannot confirm price from app_config", {
      currency,
    });
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SERVICE_UNAVAILABLE,
        message: "Pricing currently unavailable, please try again later",
      },
      { status: 503 },
    );
  }
  const amount =
    body.plan === PRO_PRODUCT_IDS.annual ? prices.annual : prices.monthly;

  const txRef = `ekwe_${auth.userId}_${body.plan.replace(
    "ekwe_pro_",
    "",
  )}_${crypto.randomUUID()}`;

  let paymentLink: string | null = null;
  try {
    const flwReq = await fetch(FLUTTERWAVE_PAYMENTS_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": FLUTTERWAVE_USER_AGENT,
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amount.toString(),
        currency: currency,
        redirect_url: CHECKOUT_REDIRECT_URL,
        customer: {
          email: auth.userEmail,
        },
        customizations: {
          title: "Ekwe Premium",
          description: `Upgrade to Ekwe Premium (${body.plan.replace("ekwe_pro_", "")})`,
        },
      }),
    });
    if (flwReq.ok) {
      const flwData: { status?: string; data?: { link?: string } } =
        await flwReq.json();
      if (flwData.status === "success" && flwData.data?.link) {
        paymentLink = flwData.data.link;
      }
    } else {
      logger.error(
        "[billing/checkout] Flutterwave payments API returned error",
        {
          status: flwReq.status,
          body: await flwReq.text().catch(() => ""),
        },
      );
    }
  } catch (err) {
    logger.error("[billing/checkout] Flutterwave payments API request failed", {
      error: describeError(err),
    });
  }

  if (!paymentLink) {
    logger.error("[billing/checkout] Flutterwave returned no payment link", {
      tx_ref: txRef,
      amount,
      currency,
    });
    return Response.json(
      {
        error: WORKER_ERROR_CODES.PAYMENT_INITIALIZATION_FAILED,
        message: "Could not start payment, please try again later",
      },
      { status: 502 },
    );
  }

  const responseBody = {
    tx_ref: txRef,
    amount,
    currency,
    public_key: env.FLUTTERWAVE_PUBLIC ?? "",
    link: paymentLink,
  };
  logger.info("[billing] Checkout session authorized", {
    tx_ref: txRef,
    amount,
    currency,
  });
  return Response.json(checkoutResponseSchema.parse(responseBody));
}

export async function handleVerifyTransaction(
  body: z.infer<typeof verifyTransactionRequestSchema>,
  env: Env,
  auth: AuthResult,
): Promise<Response> {
  const { transaction_id } = body;

  const keyGuard = guardFlutterwaveKeys(env);
  if (!keyGuard.allowed) return keyGuard.response;

  const verifyUrl = VERIFY_TRANSACTION_PATH.replace(
    "{id}",
    String(transaction_id),
  );

  let fwRes: Response;
  try {
    fwRes = await fetch(verifyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": FLUTTERWAVE_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error("[billing/verify] Flutterwave API request failed", {
      error: describeError(err),
    });
    return Response.json(
      { error: "Failed to verify payment" },
      { status: 502 },
    );
  }

  if (!fwRes.ok) {
    const text = await fwRes.text().catch(() => "");
    logger.error("[billing/verify] Flutterwave verify returned error", {
      status: fwRes.status,
      body: text.slice(0, 200),
    });
    return Response.json(
      { error: "Payment verification failed" },
      { status: 502 },
    );
  }

  const fwData: FlutterwaveVerifyResponse = await fwRes.json();

  if (fwData.data.status !== "successful") {
    logger.info("[billing/verify] Transaction not successful", {
      tx_ref: fwData.data.tx_ref,
      status: fwData.data.status,
    });
    return Response.json({ error: "Payment not completed" }, { status: 400 });
  }

  const txRefMatch = fwData.data.tx_ref.match(
    /ekwe_([a-f0-9-]+)_(monthly|annual)_/,
  );
  const userId = txRefMatch ? txRefMatch[1] : null;
  const planPart = txRefMatch ? txRefMatch[2] : null;

  if (!userId || userId !== auth.userId) {
    logger.warn("[billing/verify] tx_ref userId mismatch", {
      tx_ref: fwData.data.tx_ref,
      authUserId: auth.userId,
    });
    return Response.json(
      { error: "Transaction does not belong to this user" },
      { status: 403 },
    );
  }

  const plan =
    planPart === "annual" ? PRO_PRODUCT_IDS.annual : PRO_PRODUCT_IDS.monthly;

  const prices = await getAuthoritativePlanPrices(env, fwData.data.currency);
  if (!prices) {
    logger.warn("[billing/verify] Cannot confirm price from app_config", {
      currency: fwData.data.currency,
    });
    return Response.json(
      { error: "Pricing currently unavailable, please try again later" },
      { status: 503 },
    );
  }

  const expectedAmount =
    plan === PRO_PRODUCT_IDS.annual ? prices.annual : prices.monthly;
  const actualCents = toLowestUnit(
    Number(fwData.data.amount),
    fwData.data.currency,
  );
  const expectedCents = toLowestUnit(
    Number(expectedAmount),
    fwData.data.currency,
  );
  if (actualCents !== expectedCents) {
    logger.error("[billing/verify] Amount mismatch", {
      expected: expectedAmount,
      actual: fwData.data.amount,
      expectedCents,
      actualCents,
      tx_ref: fwData.data.tx_ref,
      currency: fwData.data.currency,
    });
    return Response.json({ error: "Payment amount mismatch" }, { status: 400 });
  }

  const period = planPart === "annual" ? "annual" : "monthly";

  const claim = await claimFlutterwaveTransaction(env, {
    flwRef: fwData.data.flw_ref,
    userId: auth.userId,
    txRef: fwData.data.tx_ref,
    amount: Number(fwData.data.amount),
    currency: fwData.data.currency,
    period,
  });

  if (!claim) {
    return Response.json(
      { error: "Failed to activate the paid plan" },
      { status: 500 },
    );
  }

  if (!claim.shouldActivate) {
    logger.info("[billing/verify] Transaction already redeemed", {
      userId: auth.userId,
      flw_ref: fwData.data.flw_ref,
    });
  }

  const applied = claim.shouldActivate
    ? await setProStatus(env, { userId: auth.userId }, true, claim.expiresAt)
    : await ensureProCoverage(env, auth.userId, claim.expiresAt);

  if (!applied.ok) {
    logger.error("[billing/verify] Failed to activate the paid plan");
    return Response.json(
      { error: "Failed to activate the paid plan" },
      { status: 500 },
    );
  }

  const permanentlyActivated = applied.permanent;

  logger.info("[billing/verify] paid plan activated via verify endpoint", {
    userId: auth.userId,
    tx_ref: fwData.data.tx_ref,
    expires_at: claim.expiresAt,
    permanent: permanentlyActivated,
  });

  return Response.json(
    verifyTransactionResponseSchema.parse({
      ok: true,
      permanent: permanentlyActivated,
      transaction_id: fwData.data.id,
      tx_ref: fwData.data.tx_ref,
    }),
  );
}

export async function handleBillingFlags(
  _request: Request,
  env: Env,
): Promise<Response> {
  try {
    const config = await retryTransient(() =>
      env.DB.prepare(
        "SELECT flutterwave_enabled, default_provider FROM app_config WHERE id = 1",
      ).first<{ flutterwave_enabled: number; default_provider: string }>(),
    );

    if (!config) {
      return Response.json({
        flutterwave_enabled: true,
        default_provider: "flutterwave",
      });
    }

    return Response.json({
      flutterwave_enabled: config.flutterwave_enabled === 1,
      default_provider: config.default_provider,
    });
  } catch (err) {
    logger.error("[billing] Failed to read app_config", {
      error: describeError(err),
    });
    return Response.json({
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    });
  }
}
