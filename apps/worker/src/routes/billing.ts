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
 *   GET /billing/flags
 *     Returns payment provider feature flags. Requires JWT auth.
 *     Reads from the payment_config table.
 */

import { WORKER_ERROR_CODES, checkoutRequestSchema } from "@ekwe/shared";
import { resolvePaymentCurrency } from "@ekwe/shared/money";
import { Env } from "../core/types";
import { logger } from "../core/logger";
import { supabaseGet } from "../services/supabase";
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
