import { logger } from "../logger";
import { Env } from "../types";
import { safeParseJSON } from "../security";
import { getRates, getRateFor, getSupportedCurrencies } from "../money";
import { roundToCurrency, toLowestUnit } from "@ekwe/shared/money";
import type { PlanPricing } from "@ekwe/shared";
import { USD_PRICE, PRO_PLAN_IDS } from "@ekwe/shared";

type PricingTable = Record<string, PlanPricing>;

const VALID_PLANS: Set<string> = new Set([
  PRO_PLAN_IDS.monthly,
  PRO_PLAN_IDS.annual,
]);

function buildPricing(rates: Record<string, number> | null): PricingTable {
  const supported = getSupportedCurrencies();
  const pricing: PricingTable = { USD: USD_PRICE };
  for (const currency of supported) {
    if (currency === "USD") continue;
    const rate = getRateFor(currency, rates);
    const monthlyAmount = roundToCurrency(
      USD_PRICE.monthly.amount * rate,
      currency,
    );
    const annualAmount = roundToCurrency(
      USD_PRICE.annual.amount * rate,
      currency,
    );
    pricing[currency] = {
      monthly: {
        amount: monthlyAmount,
        currency,
        lowestUnit: toLowestUnit(monthlyAmount, currency),
      },
      annual: {
        amount: annualAmount,
        currency,
        lowestUnit: toLowestUnit(annualAmount, currency),
      },
    };
  }
  return pricing;
}

export async function handlePricing(env: Env): Promise<Response> {
  const rates = await getRates(env);
  return Response.json({ pricing: buildPricing(rates) });
}

export async function handleCheckoutInitialize(
  request: Request,
  env: Env,
  userId: string,
  userEmail: string,
): Promise<Response> {
  try {
    const parsed = await safeParseJSON<{
      plan_id?: unknown;
      currency?: unknown;
    }>(request);

    if (!parsed.ok) {
      return Response.json(
        { error: "INVALID_JSON", message: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const { plan_id, currency } = parsed.data as {
      plan_id?: string;
      currency?: string;
    };

    if (!plan_id || !currency) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Missing plan_id or currency" },
        { status: 400 },
      );
    }

    const cur = currency.toUpperCase();
    if (!getSupportedCurrencies().includes(cur)) {
      return Response.json(
        { error: "INVALID_CURRENCY", message: `Currency ${cur} not supported` },
        { status: 400 },
      );
    }

    if (!VALID_PLANS.has(plan_id)) {
      return Response.json(
        { error: "INVALID_PLAN", message: `Unknown plan: ${plan_id}` },
        { status: 400 },
      );
    }

    const rates = await getRates(env);
    const rate = getRateFor(cur, rates);
    const usdPrice =
      USD_PRICE[plan_id === PRO_PLAN_IDS.annual ? "annual" : "monthly"];
    const rawAmount = usdPrice.amount * rate;
    const lowestUnit = toLowestUnit(rawAmount, cur);

    if (!env.PAYSTACK_SECRET_KEY) {
      logger.error("[checkout] PAYSTACK_SECRET_KEY is missing");
      return Response.json(
        { error: "SERVER_ERROR", message: "Payment gateway not configured" },
        { status: 500 },
      );
    }

    const reference = `ekwe_${userId.replace(/-/g, "")}_${crypto.randomUUID()}`;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: userEmail,
          amount: lowestUnit,
          currency: cur,
          reference,
          callback_url: "https://ekwe.app/payment-callback",
          metadata: {
            user_id: userId,
            plan_id,
            currency: currency.toUpperCase(),
            amount: lowestUnit,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[checkout] Paystack initialization failed: ${errorText}`);
      return Response.json(
        {
          error: "PAYMENT_INIT_FAILED",
          message: "Failed to initialize payment gateway",
        },
        { status: 502 },
      );
    }

    const resData = await response.json<{
      status: boolean;
      message: string;
      data: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    }>();

    if (!resData.status || !resData.data.authorization_url) {
      logger.error(
        `[checkout] Paystack response status false: ${resData.message}`,
      );
      return Response.json(
        {
          error: "PAYMENT_INIT_FAILED",
          message: "Invalid response from Paystack",
        },
        { status: 502 },
      );
    }

    return Response.json({
      url: resData.data.authorization_url,
      reference: resData.data.reference,
    });
  } catch (err) {
    logger.error(
      `[checkout] Error in initialize: ${err instanceof Error ? err.message : String(err)}`,
    );
    return Response.json(
      { error: "SERVER_ERROR", message: "An internal error occurred" },
      { status: 500 },
    );
  }
}
