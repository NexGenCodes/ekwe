import {
  WORKER_ERROR_CODES,
  checkoutRequestSchema,
  checkoutResponseSchema,
  verifyTransactionRequestSchema,
  verifyTransactionResponseSchema,
} from "@ekwe/shared";
import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { supabaseGet, supabasePost } from "@/services/supabase";
import { guardFlutterwaveKeys, computeProExpiry } from "@/services/flutterwave";
import { AuthResult } from "@/core/auth";
import {
  getAuthoritativePlanPrices,
  resolveRequestCurrency,
} from "@/routes/pricing";
import {
  guardJsonSize,
  MAX_JSON_BODY_BYTES,
  safeParseJSON,
} from "@/core/guards";

interface PaymentConfigRow {
  flutterwave_enabled: boolean;
  default_provider: string;
}

export async function handleCheckout(
  request: Request,
  env: Env,
  auth: AuthResult,
): Promise<Response> {
  const sizeGuard = guardJsonSize(request, MAX_JSON_BODY_BYTES);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const parsedBody = await safeParseJSON<unknown>(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = checkoutRequestSchema.safeParse(parsedBody.data);
  if (!parsed.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY, message: "Invalid request" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const currency = resolveRequestCurrency(body.currency, request);

  const keyGuard = guardFlutterwaveKeys(env);
  if (!keyGuard.allowed) return keyGuard.response;

  const prices = await getAuthoritativePlanPrices(env, currency);
  if (!prices) {
    logger.warn("[billing/checkout] Cannot confirm price from Supabase", {
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
    body.plan === "ekwe_pro_annual" ? prices.annual : prices.monthly;

  const txRef = `ekwe_${auth.userId}_${body.plan.replace(
    "ekwe_pro_",
    "",
  )}_${crypto.randomUUID()}`;

  const responseBody = {
    tx_ref: txRef,
    amount,
    currency,
    public_key: env.FLUTTERWAVE_PUBLIC ?? "",
  };
  logger.info("[billing] Checkout session authorized", {
    tx_ref: txRef,
    amount,
    currency,
  });
  return Response.json(checkoutResponseSchema.parse(responseBody));
}

const VERIFY_TRANSACTION_PATH =
  "https://api.flutterwave.com/v3/transactions/{id}/verify";

interface FlutterwaveVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
  };
}

export async function handleVerifyTransaction(
  request: Request,
  env: Env,
  auth: AuthResult,
): Promise<Response> {
  const sizeGuard = guardJsonSize(request, MAX_JSON_BODY_BYTES);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const parsedBody = await safeParseJSON<unknown>(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = verifyTransactionRequestSchema.safeParse(parsedBody.data);
  if (!parsed.success) {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.INVALID_BODY,
        message: "transaction_id required",
      },
      { status: 400 },
    );
  }
  const { transaction_id } = parsed.data;

  const keyGuard = guardFlutterwaveKeys(env);
  if (!keyGuard.allowed) return keyGuard.response;

  if (!env.FLUTTERWAVE_SECRET) {
    logger.error("[billing/verify] FLUTTERWAVE_SECRET not configured");
    return Response.json(
      { error: "Payment provider not configured" },
      { status: 500 },
    );
  }

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
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error("[billing/verify] Flutterwave API request failed", {
      error: err instanceof Error ? err.message : String(err),
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

  const plan = planPart === "annual" ? "ekwe_pro_annual" : "ekwe_pro_monthly";

  const prices = await getAuthoritativePlanPrices(env, fwData.data.currency);
  if (!prices) {
    logger.warn("[billing/verify] Cannot confirm price from Supabase", {
      currency: fwData.data.currency,
    });
    return Response.json(
      { error: "Pricing currently unavailable, please try again later" },
      { status: 503 },
    );
  }

  const expectedAmount =
    plan === "ekwe_pro_annual" ? prices.annual : prices.monthly;
  const actualCents = Math.round(Number(fwData.data.amount) * 100);
  const expectedCents = Math.round(Number(expectedAmount) * 100);
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

  const expiresAt = computeProExpiry(
    planPart === "annual" ? "annual" : "monthly",
  );
  const rpcResult = await supabasePost(env, "/rest/v1/rpc/set_pro_status", {
    p_email: auth.userEmail,
    p_user_id: auth.userId,
    p_is_pro: true,
    p_expires_at: expiresAt,
    p_provider: "flutterwave",
    p_payment_ref: fwData.data.flw_ref,
  });

  if (!rpcResult) {
    logger.error("[billing/verify] Failed to call set_pro_status (no env)");
    return Response.json({ error: "Failed to activate Pro" }, { status: 500 });
  }

  if (!rpcResult.ok) {
    const body = await rpcResult.text().catch(() => "");
    logger.error("[billing/verify] set_pro_status RPC failed", {
      status: rpcResult.status,
      body: body.slice(0, 200),
    });
    return Response.json({ error: "Failed to activate Pro" }, { status: 500 });
  }

  const rpcData: { permanent?: boolean } | null = await rpcResult.json();
  const permanentlyActivated = rpcData?.permanent === true;

  logger.info("[billing/verify] Pro activated via verify endpoint", {
    userId: auth.userId,
    tx_ref: fwData.data.tx_ref,
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
    const res = await supabaseGet(
      env,
      "/rest/v1/app_config?id=eq.1&select=flutterwave_enabled,default_provider",
    );

    if (!res) {
      logger.warn("[billing] Missing Supabase credentials for flags");
      return Response.json({
        flutterwave_enabled: true,
        default_provider: "flutterwave",
      });
    }

    if (!res.ok) {
      logger.warn("[billing] Failed to fetch app_config", {
        status: res.status,
      });
      return Response.json({
        flutterwave_enabled: true,
        default_provider: "flutterwave",
      });
    }

    const rows: PaymentConfigRow[] = await res.json();
    if (rows.length === 0) {
      return Response.json({
        flutterwave_enabled: true,
        default_provider: "flutterwave",
      });
    }

    const config = rows[0];
    return Response.json({
      flutterwave_enabled: config.flutterwave_enabled,
      default_provider: config.default_provider,
    });
  } catch (err) {
    logger.error("[billing] Failed to read app_config", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    });
  }
}
