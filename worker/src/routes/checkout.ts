import { logger } from "../logger";
import { PRICING_TABLE } from "../config";
import { Env } from "../types";
import { getRates, getRateFor, toLowestUnit, FALLBACK_RATES } from "../money";

export async function handleCheckoutInitialize(
  request: Request,
  env: Env,
  userId: string,
  userEmail: string,
): Promise<Response> {
  try {
    const { plan_id, currency } = (await request.json()) as {
      plan_id: "pro_monthly" | "pro_annual";
      currency: string;
    };

    if (!plan_id || !currency) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Missing plan_id or currency" },
        { status: 400 },
      );
    }

    const cur = currency.toUpperCase();
    if (!FALLBACK_RATES[cur]) {
      return Response.json(
        { error: "INVALID_CURRENCY", message: `Currency ${cur} not supported` },
        { status: 400 },
      );
    }

    const rates = await getRates(env);
    const rate = getRateFor(cur, rates);
    const usdPrice = PRICING_TABLE.USD[plan_id === "pro_annual" ? "annual" : "monthly"];
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

    const resData = (await response.json()) as {
      status: boolean;
      message: string;
      data: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    };

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
