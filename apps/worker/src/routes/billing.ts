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

import {
  WORKER_ERROR_CODES,
  checkoutRequestSchema,
  checkoutResponseSchema,
  verifyTransactionRequestSchema,
  verifyTransactionResponseSchema,
} from "@ekwe/shared";
import { Env } from "../core/types";
import { logger } from "../core/logger";
import { supabaseGet, supabasePost } from "../services/supabase";
import { guardFlutterwaveKeys } from "../services/flutterwaveKeys";
import { AuthResult } from "../core/auth";
import { getAuthoritativePlanPrices, resolveRequestCurrency } from "./pricing";

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

  // Currency is optional. An explicit client currency wins; otherwise the
  // worker resolves it from the request's geo country (Cloudflare
  // `CF-IPCountry`→billable code) and falls back to USD. Unsupported codes
  // resolve to USD so the charge is always in a currency Flutterwave bills
  // and always matches GET /pricing.
  const currency = resolveRequestCurrency(body.currency, request);

  // Fail closed in production if the configured Flutterwave keys are missing
  // or the test-mode keys (a free-Pro bypass vector). Test keys stay usable in
  // development/test deployments for the full checkout→grant flow.
  const keyGuard = guardFlutterwaveKeys(env);
  if (!keyGuard.allowed) return keyGuard.response;

  // Price the plan from the AUTHORITATIVE source (the subscription_config row
  // in Supabase) — the same source verify-transaction and the webhook grant
  // path use. Minting from getLocalPlanPrices (which falls back to bundled
  // LOCAL_PRICES when Supabase is unreachable) would let a checkout created
  // during a blip mint a price that verify-transaction later rejects (verify
  // fails closed on an unconfirmed price). Failing checkout closed here keeps
  // the amount minted always equal to what the grant path expects. The amount
  // the SDK will charge is exactly what GET /pricing reported when the row is
  // reachable, and it is echoed back in `meta` for the webhook to verify.
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
    // Server-authoritative public key so the client always initializes the
    // SDK with the key matching the configured secret's environment — the
    // mobile never picks its own (possibly test) key.
    public_key: env.FLUTTERWAVE_PUBLIC ?? "",
  };
  logger.info("[billing] Checkout session authorized", {
    tx_ref: txRef,
    amount,
    currency,
  });
  return Response.json(checkoutResponseSchema.parse(responseBody));
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
  // Parse body — must include transaction_id (shared schema, one source
  // of truth with the mobile client).
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }

  const parsed = verifyTransactionRequestSchema.safeParse(raw);
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

  // Fail closed in production if the configured Flutterwave keys are missing
  // or the test-mode keys (a free-Pro bypass vector).
  const keyGuard = guardFlutterwaveKeys(env);
  if (!keyGuard.allowed) return keyGuard.response;

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
    return Response.json({ error: "Payment not completed" }, { status: 400 });
  }

  // Extract userId and plan from tx_ref (format: ekwe_<userId>_<plan>_<ts>_<rand>).
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

  // Determine plan from tx_ref.
  const plan = planPart === "annual" ? "ekwe_pro_annual" : "ekwe_pro_monthly";

  // Verify amount and currency against authoritative pricing
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

  // Grant Pro via set_pro_status RPC.
  const rpcResult = await supabasePost(env, "/rest/v1/rpc/set_pro_status", {
    p_email: auth.userEmail,
    p_user_id: auth.userId,
    p_is_pro: true,
    p_expires_at: null,
    p_provider: "flutterwave",
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
