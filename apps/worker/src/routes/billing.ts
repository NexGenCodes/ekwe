/**
 * ─── Billing Routes ──────────────────────────────────────────────
 *
 * Endpoints for the mobile billing flow:
 *
 *   POST /billing/checkout
 *     Initializes a Flutterwave checkout session. Requires JWT auth.
 *     Accepts an optional ISO-4217 `currency` (defaults to USD) so the charge
 *     is priced in the device's local currency. Returns
 *     { checkout_url, tx_ref, amount, currency } for the mobile app to open.
 *
 *   GET /billing/flags
 *     Returns payment provider feature flags. Requires JWT auth.
 *     Reads from the payment_config table.
 */

import { WORKER_ERROR_CODES, checkoutRequestSchema } from "@ekwe/shared";
import { Env } from "../core/types";
import { logger } from "../core/logger";
import { supabaseGet } from "../services/supabase";
import { AuthResult } from "../core/auth";
import { getLocalPlanPrices } from "./pricing";

// ─── Types ───────────────────────────────────────────────────────

interface FlutterwavePaymentLink {
  status: string;
  data: {
    link: string;
    reference: string;
  };
}

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
  // (ISO-4217 alpha-3) before use.
  const currency = (body.currency ?? "USD").toUpperCase();

  if (!env.FLUTTERWAVE_SECRET) {
    logger.error("[billing] FLUTTERWAVE_SECRET not configured");
    return Response.json(
      { error: WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE },
      { status: 503 },
    );
  }

  // Price the plan in the requested currency from the single source of truth
  // (subscription_config USD base + discounts × FX). The amount Flutterwave
  // charges here is exactly what GET /pricing reported, and it is echoed back
  // in `meta` so the webhook can verify the charged amount/currency.
  const prices = await getLocalPlanPrices(env, currency);
  const amount =
    body.plan === "ekwe_pro_annual" ? prices.annual : prices.monthly;

  // Create Flutterwave payment link
  // Flutterwave API: POST https://api.flutterwave.com/v3/payments
  try {
    const fwRes = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: `ekwe_${auth.userId}_${body.plan.replace("ekwe_pro_", "")}`,
        amount,
        currency,
        redirect_url: "https://flutterwave.com/rn-redirect",
        customer: {
          email: auth.userEmail || "",
          name: auth.userId,
        },
        meta: {
          user_id: auth.userId,
          plan: body.plan,
          amount,
          currency,
        },
        customizations: {
          title: "Ekwe Pro",
          description: `Upgrade to Ekwe Pro (${body.plan.replace("ekwe_pro_", "")})`,
        },
      }),
    });

    if (!fwRes.ok) {
      const errorBody = await fwRes.text().catch(() => "");
      logger.error("[billing] Flutterwave API error", {
        status: fwRes.status,
        body: errorBody.slice(0, 300),
      });
      return Response.json(
        { error: WORKER_ERROR_CODES.PAYMENT_INITIALIZATION_FAILED },
        { status: 502 },
      );
    }

    const fwData: FlutterwavePaymentLink = await fwRes.json();

    if (fwData.status !== "success" || !fwData.data?.link) {
      logger.error("[billing] Flutterwave returned non-success", {
        status: fwData.status,
      });
      return Response.json(
        { error: WORKER_ERROR_CODES.PAYMENT_INITIALIZATION_FAILED },
        { status: 502 },
      );
    }

    return Response.json({
      checkout_url: fwData.data.link,
      tx_ref: fwData.data.reference,
      amount,
      currency,
    });
  } catch (err) {
    logger.error("[billing] Flutterwave checkout error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_SERVER_ERROR },
      { status: 500 },
    );
  }
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
