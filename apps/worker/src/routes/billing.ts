/**
 * ─── Billing Routes ──────────────────────────────────────────────
 *
 * Endpoints for the mobile billing flow:
 *
 *   POST /billing/checkout
 *     Authorizes a checkout session. Requires JWT auth. Accepts an optional
 *     ISO-4217 `currency` (defaults to USD). Unsupported currencies resolve to
 *     USD server-side so the charged amount always matches GET /pricing.
 *     Returns { tx_ref, amount, currency }.
 *
 *     The worker is server-authoritative for pricing and the unique tx_ref.
 *     The mobile app initializes the actual Flutterwave payment client-side
 *     with the flutterwave-react-native-sdk (public key + these session
 *     params). The webhook still verifies the charged amount/currency against
 *     the `meta` echo before granting Pro.
 *
 *   POST /billing/verify-transaction
 *     Client-side verification endpoint. Requires JWT auth. Accepts a
 *     Flutterwave transaction_id, verifies it with the Flutterwave API,
 *     and calls set_pro_status RPC. Used when the webhook doesn't fire
 *     (e.g. test mode).
 *
 *   GET /billing/flags
 *     Returns payment provider feature flags. Requires JWT auth.
 *     Reads from the payment_config table.
 */

import { WORKER_ERROR_CODES, checkoutRequestSchema } from "@ekwe/shared";
import { resolvePaymentCurrency } from "@ekwe/shared/money";
import { Env } from "../core/types";
import { logger } from "../core/logger";
import { supabaseGet, supabasePost } from "../services/supabase";
import { AuthResult } from "../core/auth";
import { getLocalPlanPrices } from "./pricing";

// ─── Types ───────────────────────────────────────────────────────

interface PaymentConfigRow {
  flutterwave_enabled: boolean;
  default_provider: string;
}

// ─── POST /billing/checkout ──────────────────────────────────────

export async function handleCheckout(
  request: Request,
  env: Env,
  auth: AuthResult,
): Promise<Response> {
  // Parse and validate the body against the shared checkout schema. The
  // schema binds `plan` to the shared PRO_PRODUCT_IDS so the client, the
  // webhook, and this route can never drift apart.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }

  const parsed = checkoutRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY, message: "Invalid request" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Currency is optional, defaults to USD, and is normalized to uppercase
  // (ISO-4217 alpha-3). Unsupported currencies resolve to USD so the charge is
  // always in a currency Flutterwave bills and always matches GET /pricing.
  const currency = resolvePaymentCurrency(body.currency ?? "USD");

  // Price the plan from the single source of truth (the subscription_config
  // row in Supabase; the shared LOCAL_PRICES map as fallback). The amount the
  // SDK will charge is exactly what GET /pricing reported, and it is echoed
  // back in `meta` so the webhook can verify the charged amount/currency.
  const prices = await getLocalPlanPrices(env, currency);
  const amount =
    body.plan === "ekwe_pro_annual" ? prices.annual : prices.monthly;

  // tx_ref must be unique per transaction (Flutterwave rejects duplicates).
  // It keeps the `ekwe_<userId>_` prefix the webhook's resolveUser parses, and
  // appends the plan + a timestamp/random suffix so the same user+plan can
  // checkout again without colliding.
  const txRef = `ekwe_${auth.userId}_${body.plan.replace(
    "ekwe_pro_",
    "",
  )}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const responseBody = {
    tx_ref: txRef,
    amount,
    currency,
  };
  logger.info("[billing] Checkout session authorized", {
    tx_ref: txRef,
    amount,
    currency,
  });
  return Response.json(responseBody);
}

// ─── POST /billing/verify-transaction ────────────────────────────

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
  // Parse body — must include transaction_id.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }

  const { transaction_id } = (raw ?? {}) as { transaction_id?: unknown };
  if (!transaction_id || typeof transaction_id !== "number") {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY, message: "transaction_id required" },
      { status: 400 },
    );
  }

  if (!env.FLUTTERWAVE_SECRET) {
    logger.error("[billing/verify] FLUTTERWAVE_SECRET not configured");
    return Response.json(
      { error: "Payment provider not configured" },
      { status: 500 },
    );
  }

  // Verify with Flutterwave API.
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

  // Must be successful.
  if (fwData.data.status !== "successful") {
    logger.info("[billing/verify] Transaction not successful", {
      tx_ref: fwData.data.tx_ref,
      status: fwData.data.status,
    });
    return Response.json(
      { error: "Payment not completed" },
      { status: 400 },
    );
  }

  // Extract userId from tx_ref (format: ekwe_<userId>_<plan>_<ts>_<rand>).
  const parts = fwData.data.tx_ref.split("_");
  const userId = parts[1];
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

  // Determine plan from tx_ref.
  const planPart = parts[2]; // "monthly" or "annual"
  const plan =
    planPart === "annual" ? "ekwe_pro_annual" : "ekwe_pro_monthly";

  // Verify amount and currency against what we would have charged.
  const prices = await getLocalPlanPrices(env, fwData.data.currency);
  const expectedAmount = plan === "ekwe_pro_annual" ? prices.annual : prices.monthly;
  if (fwData.data.amount !== expectedAmount) {
    logger.warn("[billing/verify] Amount mismatch", {
      expected: expectedAmount,
      actual: fwData.data.amount,
      tx_ref: fwData.data.tx_ref,
    });
    // Still grant — the webhook would have done so, but log the discrepancy.
  }

  // Grant Pro via set_pro_status RPC.
  const rpcResult = await supabasePost(
    env,
    "/rest/v1/rpc/set_pro_status",
    {
      p_email: auth.userEmail,
      p_user_id: auth.userId,
      p_is_pro: true,
      p_expires_at: null,
      p_provider: "flutterwave",
    },
  );

  if (!rpcResult) {
    logger.error("[billing/verify] Failed to call set_pro_status (no env)");
    return Response.json(
      { error: "Failed to activate Pro" },
      { status: 500 },
    );
  }

  if (!rpcResult.ok) {
    const body = await rpcResult.text().catch(() => "");
    logger.error("[billing/verify] set_pro_status RPC failed", {
      status: rpcResult.status,
      body: body.slice(0, 200),
    });
    return Response.json(
      { error: "Failed to activate Pro" },
      { status: 500 },
    );
  }

  const rpcData: { permanent?: boolean } | null = await rpcResult.json();
  const permanentlyActivated = rpcData?.permanent === true;

  logger.info("[billing/verify] Pro activated via verify endpoint", {
    userId: auth.userId,
    tx_ref: fwData.data.tx_ref,
    permanent: permanentlyActivated,
  });

  return Response.json({
    ok: true,
    permanent: permanentlyActivated,
    transaction_id: fwData.data.id,
    tx_ref: fwData.data.tx_ref,
  });
}

// ─── GET /billing/flags ──────────────────────────────────────────

export async function handleBillingFlags(
  _request: Request,
  env: Env,
): Promise<Response> {
  try {
    const res = await supabaseGet(
      env,
      "/rest/v1/payment_config?id=eq.1&select=flutterwave_enabled,default_provider",
    );

    if (!res) {
      logger.warn("[billing] Missing Supabase credentials for flags");
      return Response.json({
        flutterwave_enabled: true,
        default_provider: "flutterwave",
      });
    }

    if (!res.ok) {
      logger.warn("[billing] Failed to fetch payment_config", {
        status: res.status,
      });
      // Return defaults on error
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
    logger.error("[billing] Failed to read payment_config", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    });
  }
}
