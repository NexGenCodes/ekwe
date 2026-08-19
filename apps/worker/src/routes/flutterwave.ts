/**
 * ─── Flutterwave Webhook Handler ─────────────────────────────────
 *
 * Handles payment lifecycle events from Flutterwave (cards, mobile money,
 * bank transfer, USSD). Maps each event type to a subscription status change
 * via the shared `set_pro_status` RPC.
 *
 * Event flow:
 *   1. Flutterwave fires a webhook to POST /webhook/flutterwave
 *   2. signatures.ts verifies the `verif-hash` and/or `flutterwave-signature`
 *   3. This handler maps the event → Pro status change
 *   4. set_pro_status RPC writes to user_subscriptions (provider: "flutterwave")
 *   5. JWT hook reads user_subscriptions → injects is_pro claim
 *
 * Supported event types:
 *   - charge.success: One-time payment or initial subscription → grant Pro
 *   - charge.failed / charge.abandoned: Payment failed → no action
 *   - subscription.paused: Subscription paused → revoke (no grace period)
 *   - subscription.completed: Final payment in installment plan → keep Pro
 *   - subscription.cancelled: User cancelled → keep until expires_at
 *   - subscription.expired: Subscription fully expired → revoke Pro
 *   - invoice.payment_failed: Renewal failed → no action (wait for expiry)
 *   - invoice.updated: Renewal succeeded → extend Pro
 */

import { logger } from "../core/logger";
import { registerProvider, ProviderResult } from "../services/billing";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { readLimitedBody } from "../core/guards";
import { supabasePost } from "../services/supabase";
import { verifyWebhook } from "../services/signatures";
import { toLowestUnit } from "@ekwe/shared/money";

// ─── Constants ───────────────────────────────────────────────────

const WEBHOOK_MAX_BYTES = 256 * 1024; // 256KB
const SUPABASE_TIMEOUT_MS = 15_000;

// ─── Types ───────────────────────────────────────────────────────

interface FlutterwaveEvent {
  id: number;
  event: string;
  created_at: string;
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
      phone_number: string | null;
      email: string;
    };
    meta?: {
      user_id?: string;
      plan?: string;
      amount?: number;
      currency?: string;
    };
    subscription?: {
      id: number;
      amount: number;
      subscription_code: string;
      email_token: string;
      status: string;
      next_payment_date: string | null;
      end_date: string | null;
    };
  };
}

interface ProStatusResult {
  ok: boolean;
  permanent: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────

function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Calls the set_pro_status RPC with the given parameters. The RPC inserts or
 * updates a row in user_subscriptions and derives the canonical tier. The
 * optional p_expires_at parameter prevents overwriting a future expiry with null
 * on cancellation events (the RPC guards this internally).
 */
async function setProStatus(
  env: Env,
  identifier: { email?: string; userId?: string },
  isPro: boolean,
  expiresAt?: string | null,
  provider: string = "flutterwave",
): Promise<ProStatusResult> {
  try {
    const res = await supabasePost(
      env,
      "/rest/v1/rpc/set_pro_status",
      {
        p_email: identifier.email || null,
        p_user_id: identifier.userId || null,
        p_is_pro: isPro,
        p_expires_at: expiresAt ?? null,
        p_provider: provider,
      },
      SUPABASE_TIMEOUT_MS,
    );

    if (!res) {
      logger.error(
        "[flutterwave] Missing Supabase credentials to update subscription",
      );
      return { ok: false, permanent: false };
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      const permanent = isPermanentFailure(res.status);
      logger.error("[flutterwave] set_pro_status RPC failed", {
        status: res.status,
        body,
        permanent,
      });
      return { ok: false, permanent };
    }
    return { ok: true, permanent: false };
  } catch (err) {
    logger.error("[flutterwave] set_pro_status error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, permanent: false };
  }
}

/**
 * Resolves a Flutterwave customer to a Supabase auth user. Tries email first
 * (Flutterwave always provides customer.email), then falls back to user ID
 * metadata if present in tx_ref.
 */
function resolveUser(
  env: Env,
  email: string | null,
  txRef: string | null,
): { email?: string; userId?: string } | null {
  if (email) return { email };
  // tx_ref format may include user_id: "ekwe_user_xxx_monthly"
  if (txRef) {
    const match = txRef.match(/ekwe_([a-f0-9-]+)_/);
    if (match) return { userId: match[1] };
  }
  return null;
}

/**
 * Verifies the charged amount/currency against the checkout `meta` echo.
 * The worker embedded `meta.amount`/`meta.currency` when creating the payment
 * link; Flutterwave echoes `meta` in webhooks. Comparing the charged
 * `data.amount`/`data.currency` against it (to lowest-unit precision) prevents
 * granting Pro for a tampered, wrong-price, or wrong-currency payment.
 * Returns true when verification passes or when meta is absent (legacy
 * links), false on mismatch.
 */
function verifyChargeAmount(data: {
  amount?: number;
  currency?: string;
  meta?: { amount?: number; currency?: string };
}): boolean {
  const expected = data.meta?.amount;
  const expectedCurrency = data.meta?.currency?.toUpperCase();
  if (
    typeof expected !== "number" ||
    typeof data.amount !== "number" ||
    !expectedCurrency
  ) {
    // No expected amount embedded (legacy checkout) or unusable payload —
    // nothing to verify against; fall through to the normal grant path.
    return true;
  }

  const chargedCurrency = (data.currency ?? "").toUpperCase();
  if (chargedCurrency !== expectedCurrency) {
    logger.error("[flutterwave] Currency mismatch on charge.success", {
      charged: chargedCurrency,
      expected: expectedCurrency,
    });
    return false;
  }

  const charged = toLowestUnit(data.amount, expectedCurrency);
  const wanted = toLowestUnit(expected, expectedCurrency);
  if (charged !== wanted) {
    logger.error("[flutterwave] Amount mismatch on charge.success", {
      charged: data.amount,
      expected,
      currency: expectedCurrency,
    });
    return false;
  }

  return true;
}

// ─── Event Processor ─────────────────────────────────────────────

async function processFlutterwaveEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<ProviderResult> {
  const fwEvent = event as unknown as FlutterwaveEvent;
  const eventType = fwEvent.event;
  const data = fwEvent.data;

  logger.info(`[flutterwave] Event: ${eventType}`, {
    id: fwEvent.id,
    tx_ref: data?.tx_ref,
    status: data?.status,
  });

  if (!data) {
    logger.warn("[flutterwave] Missing event data");
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  const email = data.customer?.email ?? null;
  const txRef = data.tx_ref ?? null;
  const identifier = resolveUser(env, email, txRef);

  if (!identifier) {
    logger.warn("[flutterwave] Could not resolve user from event", {
      email,
      tx_ref: txRef,
    });
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  // ── Activation Events ──
  // charge.success: Initial payment or renewal. Grant Pro.
  if (eventType === "charge.success" && data.status === "successful") {
    if (!verifyChargeAmount(data)) {
      // Do NOT grant Pro and do NOT ack as applied — log and reject. We still
      // return fullyApplied=true so Flutterwave stops retrying a permanent
      // fraud/tamper condition; the money is not converted into Pro access.
      return {
        response: Response.json({ received: true, action: "rejected" }),
        fullyApplied: true,
      };
    }

    // Check if this is a subscription payment (recurring) or one-time
    const expiresAt = data.subscription?.end_date
      ? new Date(data.subscription.end_date).toISOString()
      : null;

    const applied = await setProStatus(env, identifier, true, expiresAt);
    logger.info("[flutterwave] Subscription activated", {
      email,
      tx_ref: txRef,
    });
    return {
      response: Response.json({ received: true, action: "activated" }),
      fullyApplied: applied.ok,
    };
  }

  // ── Invoice Events ──
  // invoice.updated with status=success: Renewal succeeded → extend Pro
  if (eventType === "invoice.updated") {
    const sub = data.subscription;
    if (sub?.end_date) {
      const applied = await setProStatus(
        env,
        identifier,
        true,
        new Date(sub.end_date).toISOString(),
      );
      logger.info("[flutterwave] Subscription renewed via invoice", {
        email,
        tx_ref: txRef,
      });
      return {
        response: Response.json({ received: true, action: "renewed" }),
        fullyApplied: applied.ok,
      };
    }
    // No end_date → skip (status unknown)
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  // ── Subscription Events ──
  // subscription.paused: No grace period on Flutterwave → revoke immediately
  if (eventType === "subscription.paused") {
    const applied = await setProStatus(env, identifier, false, null);
    logger.info("[flutterwave] Subscription paused", {
      email,
      tx_ref: txRef,
    });
    return {
      response: Response.json({ received: true, action: "deactivated" }),
      fullyApplied: applied.ok,
    };
  }

  // subscription.completed: Final installment paid → keep Pro until end_date
  if (eventType === "subscription.completed") {
    const expiresAt = data.subscription?.end_date
      ? new Date(data.subscription.end_date).toISOString()
      : null;
    const applied = await setProStatus(env, identifier, true, expiresAt);
    logger.info("[flutterwave] Subscription completed", {
      email,
      tx_ref: txRef,
    });
    return {
      response: Response.json({ received: true, action: "retained" }),
      fullyApplied: applied.ok,
    };
  }

  // subscription.cancelled: User cancelled → keep Pro until expires_at
  // (Flutterwave still grants access until end_date)
  if (eventType === "subscription.cancelled") {
    const expiresAt = data.subscription?.end_date
      ? new Date(data.subscription.end_date).toISOString()
      : null;
    // Keep is_pro=true so the user retains access through the paid period.
    // The expires_at is the authoritative end date enforced by the JWT hook.
    const applied = await setProStatus(env, identifier, true, expiresAt);
    logger.info("[flutterwave] Subscription cancelled (retained until expiry)", {
      email,
      tx_ref: txRef,
      expires_at: expiresAt,
    });
    return {
      response: Response.json({ received: true, action: "retained" }),
      fullyApplied: applied.ok,
    };
  }

  // subscription.expired: Full expiry → revoke Pro
  if (eventType === "subscription.expired") {
    const applied = await setProStatus(env, identifier, false, null);
    logger.info("[flutterwave] Subscription expired", {
      email,
      tx_ref: txRef,
    });
    return {
      response: Response.json({ received: true, action: "deactivated" }),
      fullyApplied: applied.ok,
    };
  }

  // ── Ignored Events ──
  const ignoredEvents = new Set([
    "charge.failed",
    "charge.abandoned",
    "charge.pending",
    "charge.initiated",
    "invoice.payment_failed",
    "transfer.completed",
    "transfer.failed",
    "transfer.reversed",
  ]);

  if (ignoredEvents.has(eventType)) {
    logger.info(`[flutterwave] Ignored event: ${eventType}`);
    return {
      response: Response.json({ received: true, action: "ignored" }),
      fullyApplied: true,
    };
  }

  // Unknown event types — log and ack (don't block retries for unknowns)
  logger.warn(`[flutterwave] Unhandled event type: ${eventType}`);
  return {
    response: Response.json({ received: true, action: "unknown" }),
    fullyApplied: true,
  };
}

// ─── Register Provider ───────────────────────────────────────────

registerProvider("flutterwave", {
  enabled: (env) => !!env.FLUTTERWAVE_WEBHOOK_SECRET,
  process: processFlutterwaveEvent,
});

// ─── Route Handler ───────────────────────────────────────────────
// This is the top-level handler for POST /webhook/flutterwave.
// It reads the body, parses it, and delegates to the provider registry.

export async function handleFlutterwaveWebhook(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Max size guard
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength, 10) > WEBHOOK_MAX_BYTES) {
    logger.warn(
      `[flutterwave] Payload too large: ${contentLength} bytes`,
    );
    return Response.json(
      { error: WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE },
      { status: 413 },
    );
  }

  let rawBody: string;
  try {
    const bytes = await readLimitedBody(request, WEBHOOK_MAX_BYTES);
    if (bytes === null) {
      logger.warn(
        `[flutterwave] Body exceeds size limit: ${WEBHOOK_MAX_BYTES} bytes`,
      );
      return Response.json(
        { error: WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE },
        { status: 413 },
      );
    }
    rawBody = new TextDecoder().decode(bytes);
  } catch (err) {
    logger.warn("[flutterwave] Failed to read body", {
      error: String(err),
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  // ── Signature Verification ──
  // The dedicated Flutterwave webhook route MUST verify signatures just like
  // the generic `/webhook` handler. Accepting unauthenticated webhooks would
  // let an attacker grant or revoke Pro at will.
  const verification = await verifyWebhook(request, rawBody, env);

  if (!verification.isValid) {
    logger.warn(
      `[flutterwave] Rejected: provider=${verification.provider}, error=${verification.error || "signature mismatch"}`,
    );
    return Response.json(
      {
        error: verification.code ?? WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
        message: "Webhook signature verification failed.",
      },
      { status: 401 },
    );
  }

  logger.info(`[flutterwave] Verified: provider=${verification.provider}`);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("[flutterwave] Malformed JSON body");
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }

  // Use the processWebhookEvent from the registry, which checks if the
  // provider is enabled and handles the unknown case.
  const { processWebhookEvent } = await import("../services/billing");
  const { response, fullyApplied } = await processWebhookEvent(
    "flutterwave",
    event,
    env,
  );

  if (!fullyApplied) {
    logger.warn(
      "[flutterwave] Event not fully applied; returning 500 so Flutterwave retries",
    );
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SERVER_ERROR,
        message: "Failed to sync subscription state; retryable",
      },
      { status: 500 },
    );
  }

  return response;
}
