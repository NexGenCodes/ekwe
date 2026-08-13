import { Env } from "../types";
import { logger } from "../logger";
import { verifyWebhook, WebhookProvider } from "../signatures";
import { getRates, getRateFor } from "../money";
import { toLowestUnit } from "@ekwe/shared/money";
import { USD_PRICE, PRO_PLAN_IDS, PRO_PRODUCT_IDS } from "@ekwe/shared";
import { readLimitedBody } from "../security";

const WEBHOOK_MAX_BYTES = 256 * 1024; // 256KB
const IDEMPOTENCY_TTL = 86400; // 24 hours

/**
 * Fraction of the expected price a charged amount may drift from the
 * amount quoted at checkout time (FX rates move between checkout and
 * the webhook arrival). Exact metadata.amount match is preferred.
 */
const CHARGE_TOLERANCE_RATIO = 0.05;

function toPlanPeriod(planId: string | undefined): "monthly" | "annual" | null {
  if (planId === PRO_PLAN_IDS.monthly) return "monthly";
  if (planId === PRO_PLAN_IDS.annual) return "annual";
  return null;
}

function amountsMatch(charged: number, expected: number): boolean {
  if (!Number.isFinite(charged) || !Number.isFinite(expected)) return false;
  return Math.abs(charged - expected) <= Math.max(1, Math.round(expected * CHARGE_TOLERANCE_RATIO));
}

/**
 * Validates that a successful charge actually paid for a Pro plan before
 * granting access. Prevents granting Pro from forged/mismatched payloads.
 * Returns the userId to activate, or null if the charge should be ignored.
 *
 * Provider differences (both send custom init metadata, just under different
 * keys):
 *  - Paystack stores the checkout payload under `data.metadata` and the
 *    charged amount is `data.amount` (lowest unit).
 *  - Flutterwave stores it under `data.meta` and the amount actually charged
 *    is `data.charged_amount` (falls back to `data.amount`).
 */
async function validateProCharge(
  env: Env,
  data: Record<string, unknown>,
  provider: "paystack" | "flutterwave",
): Promise<string | null> {
  const metadataField = provider === "flutterwave" ? "meta" : "metadata";
  const amountField =
    provider === "flutterwave" && data.charged_amount !== undefined
      ? "charged_amount"
      : "amount";

  const metadata = data[metadataField] as Record<string, unknown> | undefined;
  const planId = metadata?.plan_id as string | undefined;
  const period = toPlanPeriod(planId);
  const currency = (metadata?.currency as string | undefined) ?? (data.currency as string | undefined);
  const charged = data[amountField] as number | undefined;
  const expectedAmount = metadata?.amount as number | undefined;

  if (!period || !currency || typeof charged !== "number") {
    logger.warn(
      "[webhook] Charge missing plan/currency/amount; refusing to activate",
      { planId, currency, charged, provider },
    );
    return null;
  }

  const rates = await getRates(env);
  const rate = getRateFor(currency, rates);
  const expected = toLowestUnit(USD_PRICE[period].amount * rate, currency);
  const expectedLowestUnit = Math.round(expected);

  if (expectedAmount !== undefined && !amountsMatch(charged, Number(expectedAmount))) {
    logger.warn(
      `[webhook] Charge amount ${charged} does not match quoted amount ${expectedAmount}; refusing to activate`,
    );
    return null;
  }

  if (!amountsMatch(charged, expectedLowestUnit)) {
    logger.warn(
      `[webhook] Charge amount ${charged} deviates from expected ${expectedLowestUnit} (${currency}, ${period}); refusing to activate`,
    );
    return null;
  }

  const metadataUserId = metadata?.user_id as string | undefined;
  return metadataUserId ?? null;
}

async function setProStatus(
  env: Env,
  identifier: { email?: string; userId?: string },
  isPro: boolean,
  expiresAt?: string | null,
): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error(
      "[webhook] Missing Supabase credentials to update subscription",
    );
    return false;
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/set_pro_status`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_email: identifier.email || null,
        p_user_id: identifier.userId || null,
        p_is_pro: isPro,
        p_expires_at: expiresAt ?? null,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger.error(
        `[webhook] Failed to update pro status. Response: ${errorText}`,
      );
      return false;
    }

    logger.info(
      `[webhook] Successfully set pro status to ${isPro} for ${identifier.email || identifier.userId}`,
    );
    return true;
  } catch (err) {
    logger.error(
      `[webhook] Error updating pro status: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function setSubscriptionStatus(
  env: Env,
  emailOrUserId: string,
  isPro: boolean,
  expiresAt?: string | null,
): Promise<boolean> {
  const isEmail = emailOrUserId.includes("@");
  return setProStatus(
    env,
    isEmail ? { email: emailOrUserId } : { userId: emailOrUserId },
    isPro,
    expiresAt,
  );
}

/**
 * Result of a webhook event processor. `fullyApplied` is true when every
 * state change the event requires was applied (including any Supabase
 * set_pro_status call). The idempotency key is only stored when true, so a
 * failed Pro grant (e.g. Supabase down) can be retried on re-delivery.
 */
interface ProcessorResult {
  response: Response;
  fullyApplied: boolean;
}

async function processPaystackEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<ProcessorResult> {
  const eventType = event.event as string;
  const data = event.data as Record<string, unknown>;

  logger.info(`[webhook:paystack] Event: ${eventType}`, {
    reference: data?.reference,
  });

  switch (eventType) {
    case "charge.success": {
      const validatedUserId = await validateProCharge(env, data, "paystack");

      if (!validatedUserId) {
        logger.warn(
          "[webhook:paystack] Charge validation failed or missing validated user_id in charge.success",
        );
        return {
          response: Response.json({ received: true, action: "skipped" }),
          fullyApplied: true,
        };
      }

      const applied = await setSubscriptionStatus(env, validatedUserId, true);

      logger.info(
        `[webhook:paystack] charge.success processed for ${validatedUserId} (validated user_id)`,
      );
      return {
        response: Response.json({ received: true, action: "activated" }),
        fullyApplied: applied,
      };
    }

    case "subscription.disable":
    case "subscription.not_renew": {
      const email = (data?.customer as Record<string, unknown>)
        ?.email as string;
      if (email) {
        const applied = await setSubscriptionStatus(env, email, false);
        logger.info(`[webhook:paystack] Subscription ended for ${email}`);
        return {
          response: Response.json({ received: true, action: "deactivated" }),
          fullyApplied: applied,
        };
      }
      return {
        response: Response.json({ received: true, action: "deactivated" }),
        fullyApplied: true,
      };
    }

    default:
      logger.info(`[webhook:paystack] Unhandled event: ${eventType}`);
      return {
        response: Response.json({ received: true, action: "ignored" }),
        fullyApplied: true,
      };
  }
}

async function processFlutterwaveEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<ProcessorResult> {
  const eventType = event.event as string;
  const data = event.data as Record<string, unknown>;

  logger.info(`[webhook:flutterwave] Event: ${eventType}`, {
    txRef: data?.tx_ref,
  });

  switch (eventType) {
    case "charge.completed": {
      const status = data?.status as string;
      if (status !== "successful") {
        logger.warn(`[webhook:flutterwave] Non-successful charge: ${status}`);
        return {
          response: Response.json({ received: true, action: "skipped" }),
          fullyApplied: true,
        };
      }

      const validatedUserId = await validateProCharge(env, data, "flutterwave");

      if (!validatedUserId) {
        logger.warn(
          "[webhook:flutterwave] Charge validation failed or missing validated user_id",
        );
        return {
          response: Response.json({ received: true, action: "skipped" }),
          fullyApplied: true,
        };
      }

      const applied = await setSubscriptionStatus(env, validatedUserId, true);

      logger.info(
        `[webhook:flutterwave] Payment successful for ${validatedUserId} (validated user_id)`,
      );
      return {
        response: Response.json({ received: true, action: "activated" }),
        fullyApplied: applied,
      };
    }

    default:
      logger.info(`[webhook:flutterwave] Unhandled event: ${eventType}`);
      return {
        response: Response.json({ received: true, action: "ignored" }),
        fullyApplied: true,
      };
  }
}

// RevenueCat product identifiers for the Pro subscription (see
// apps/mobile/src/constants/billing.ts). Activation events for any other
// product must NOT grant Pro access.
const RC_PRO_PRODUCT_IDS: Set<string> = new Set([
  PRO_PRODUCT_IDS.monthly,
  PRO_PRODUCT_IDS.annual,
]);
const RC_PRO_ENTITLEMENT = "pro";

function isProPurchase(eventData: Record<string, unknown>): boolean {
  const productId = eventData.product_id;
  if (typeof productId === "string" && RC_PRO_PRODUCT_IDS.has(productId)) {
    return true;
  }
  const entitlementIds = eventData.entitlement_ids;
  if (
    Array.isArray(entitlementIds) &&
    entitlementIds.some((e) => e === RC_PRO_ENTITLEMENT)
  ) {
    return true;
  }
  return eventData.entitlement_id === RC_PRO_ENTITLEMENT;
}

async function processRevenueCatEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<ProcessorResult> {
  const eventData = event.event as Record<string, unknown> | undefined;
  const eventType = eventData?.type as string;

  logger.info(`[webhook:revenuecat] Event: ${eventType}`);

  const activationEvents = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "NON_RENEWING_PURCHASE",
  ]);

  // Only EXPIRATION revokes access. RevenueCat grants paid-through access on
  // CANCELLATION and a grace period on BILLING_ISSUE, so deactivating on those
  // would strip Pro while the user is still entitled to it. The stored
  // expires_at already enforces the true end date in the access-token hook.
  const deactivationEvents = new Set(["EXPIRATION"]);

  // Paid-through / grace events: access continues, but the stored expiry is
  // refreshed so the hook still cuts access at the true (post-grace) end date.
  const accessEvents = new Set(["CANCELLATION", "BILLING_ISSUE"]);

  const appUserId = eventData?.app_user_id as string;
  if (!eventData || !appUserId) {
    logger.warn("[webhook:revenuecat] Missing event data or app_user_id");
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  // RevenueCat reports times in ms since epoch; convert to an ISO timestamp
  // so the access-token hook can enforce expiry even before an EXPIRATION
  // webhook lands (e.g. a lapsed sub mid-day).
  const expiresAtMs = eventData?.expires_at_ms as number | undefined;
  const expiresAt = Number.isFinite(expiresAtMs)
    ? new Date(expiresAtMs!).toISOString()
    : null;

  if (activationEvents.has(eventType)) {
    if (!isProPurchase(eventData)) {
      logger.warn(
        "[webhook:revenuecat] Activation event for non-Pro product; refusing to grant",
        { productId: eventData.product_id, eventType },
      );
      return {
        response: Response.json({ received: true, action: "skipped" }),
        fullyApplied: true,
      };
    }
    const applied = await setSubscriptionStatus(env, appUserId, true, expiresAt);
    logger.info(`[webhook:revenuecat] Subscription activated for ${appUserId}`);
    return {
      response: Response.json({ received: true, action: "activated" }),
      fullyApplied: applied,
    };
  }

  if (accessEvents.has(eventType)) {
    if (!isProPurchase(eventData)) {
      logger.warn(
        "[webhook:revenuecat] Access event for non-Pro product; ignoring",
        { productId: eventData.product_id, eventType },
      );
      return {
        response: Response.json({ received: true, action: "skipped" }),
        fullyApplied: true,
      };
    }
    // Keep the entitlement active through the paid-through/grace period; only
    // refresh the stored expiry so the access-token hook still enforces the
    // real end date.
    const applied = expiresAt
      ? await setSubscriptionStatus(env, appUserId, true, expiresAt)
      : true;
    logger.info(
      `[webhook:revenuecat] Subscription retained (${eventType}) for ${appUserId}`,
    );
    return {
      response: Response.json({ received: true, action: "retained" }),
      fullyApplied: applied,
    };
  }

  if (deactivationEvents.has(eventType)) {
    const applied = await setSubscriptionStatus(
      env,
      appUserId,
      false,
      expiresAt,
    );
    logger.info(`[webhook:revenuecat] Subscription ended for ${appUserId}`);
    return {
      response: Response.json({ received: true, action: "deactivated" }),
      fullyApplied: applied,
    };
  }

  logger.info(`[webhook:revenuecat] Unhandled event: ${eventType}`);
  return {
    response: Response.json({ received: true, action: "ignored" }),
    fullyApplied: true,
  };
}

const PROCESSORS: Record<
  WebhookProvider,
  (event: Record<string, unknown>, env: Env) => Promise<ProcessorResult>
> = {
  paystack: processPaystackEvent,
  flutterwave: processFlutterwaveEvent,
  revenuecat: processRevenueCatEvent,
  unknown: () =>
    Promise.resolve({
      response: Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 }),
      fullyApplied: true,
    }),
};

export async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Max size guard
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength, 10) > WEBHOOK_MAX_BYTES) {
    logger.warn(`[webhook] Payload too large: ${contentLength} bytes`);
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let rawBody: string;
  try {
    const bytes = await readLimitedBody(request, WEBHOOK_MAX_BYTES);
    if (bytes === null) {
      logger.warn(`[webhook] Body exceeds size limit: ${WEBHOOK_MAX_BYTES} bytes`);
      return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    rawBody = new TextDecoder().decode(bytes);
  } catch (err) {
    logger.warn("[webhook] Failed to read body", { error: String(err) });
    return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // Idempotency: hash body to deduplicate duplicate webhook deliveries
  const bodyHash = await hashString(rawBody);
  const idempotencyKey = `webhook:idempotency:${bodyHash}`;

  if (env.EKWE_KV) {
    const existing = await env.EKWE_KV.get(idempotencyKey);
    if (existing) {
      logger.info(
        `[webhook] Duplicate event detected (hash: ${bodyHash.slice(0, 8)})`,
      );
      return Response.json({ received: true, action: "duplicate" });
    }
  }

  const verification = await verifyWebhook(request, rawBody, env);

  if (!verification.isValid) {
    logger.warn(
      `[webhook] Rejected: provider=${verification.provider}, error=${verification.error || "signature mismatch"}`,
    );
    return Response.json(
      {
        error: "INVALID_SIGNATURE",
        message: "Webhook signature verification failed.",
      },
      { status: 401 },
    );
  }

  logger.info(`[webhook] Verified: provider=${verification.provider}`);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("[webhook] Valid signature but malformed JSON body", {
      provider: verification.provider,
    });
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const processor = PROCESSORS[verification.provider];
  const { response, fullyApplied } = await processor(event, env);

  // Store the idempotency key only after the event was fully applied. If a Pro
  // status update failed (e.g. Supabase down), skip the store so a re-delivery
  // of the same event is not deduped and can retry the grant.
  if (env.EKWE_KV && response.ok && fullyApplied) {
    ctx.waitUntil(
      env.EKWE_KV.put(idempotencyKey, "1", {
        expirationTtl: IDEMPOTENCY_TTL,
      }).catch((err: unknown) =>
        logger.error("[webhook] Failed to store idempotency key", {
          error: String(err),
        }),
      ),
    );
  }

  return response;
}

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
