import { APP_VERSION, WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { registerProvider, ProviderResult } from "@/services/billing";
import { claimFlutterwaveTransaction } from "@/services/flutterwave-claim";
import { describeError, retryTransient } from "@/db/retry";
import { fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { jitteredBackoffMs } from "@/utils/retry";
import { normalizeEmail } from "@ekwe/shared";
import { toLowestUnit, resolvePaymentCurrency } from "@ekwe/shared/money";
import { getAuthoritativePlanPrices } from "@/routes/pricing";
import { syncBillingEntitlement, syncUserPremiumCache } from "@/auth/users";
import {
  parseEventOccurredAt,
  recordBillingEvent,
  type BillingEventStatus,
} from "@/services/billing-events";
import {
  recordProviderSnapshot,
  upsertDispute,
  upsertPaymentAttempt,
  upsertRefund,
} from "@/services/billing-ledger";

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

type ChargeVerification =
  { outcome: "ok" } | { outcome: "reject" } | { outcome: "retry" };

export type BillingPlanPeriod = "monthly" | "annual";

export interface FlutterwaveKeyGuard {
  allowed: boolean;
  response: Response;
}

export interface FlwTransactionsResponse {
  status: string;
  message: string;
  meta: {
    page_info: {
      total: number;
      current_page: number;
      total_pages: number;
    };
  };
  data: Array<{
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
    customer: {
      id: number;
      name: string;
      email: string;
      phone_number: string | null;
    };
    meta?: {
      user_id?: string;
      plan?: string;
    };
  }>;
}

const TEST_SECRET_PREFIX = "FLWSECK_TEST-";
const TEST_PUBLIC_PREFIX = "FLWPUBK_TEST-";

export function guardFlutterwaveKeys(env: {
  APP_ENV?: string;
  FLUTTERWAVE_SECRET?: string;
  FLUTTERWAVE_PUBLIC?: string;
}): FlutterwaveKeyGuard {
  const isProduction = env.APP_ENV === "production";

  const reject = (why: string): FlutterwaveKeyGuard => {
    logger.error(`[flutterwave] Rejected payment keys: ${why}`);
    return {
      allowed: false,
      response: Response.json(
        { error: WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE },
        { status: 503 },
      ),
    };
  };

  if (!env.FLUTTERWAVE_SECRET) return reject("secret key missing");
  if (!env.FLUTTERWAVE_PUBLIC) return reject("public key missing");

  if (isProduction) {
    if (env.FLUTTERWAVE_SECRET.startsWith(TEST_SECRET_PREFIX)) {
      return reject(
        "secret key is TEST-prefixed (FLWSECK_TEST-) — set a live key",
      );
    }
    if (env.FLUTTERWAVE_PUBLIC.startsWith(TEST_PUBLIC_PREFIX)) {
      return reject(
        "public key is TEST-prefixed (FLWPUBK_TEST-) — set a live key",
      );
    }
  }

  return {
    allowed: true,
    response: Response.json({}),
  };
}

function parseEndDate(endDate: string | null | undefined): number | null {
  if (!endDate) return null;
  const parsed = Date.parse(endDate);
  return Number.isNaN(parsed) ? null : parsed;
}

function ackResult(
  response: Response,
  applied: ProStatusResult,
): ProviderResult {
  return { response, fullyApplied: applied.ok || applied.permanent };
}

export async function ensureProCoverage(
  env: Env,
  userId: string,
  expiresAt: number,
): Promise<ProStatusResult> {
  try {
    const row = await retryTransient(() =>
      env.DB.prepare(
        "SELECT id, role, tier, pro_expires_at FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<{
          id: string;
          role: string;
          tier: string;
          pro_expires_at: number | null;
        }>(),
    );
    if (!row) return { ok: false, permanent: false };

    const billing = await retryTransient(() =>
      env.DB.prepare(
        `SELECT status, expires_at FROM user_subscriptions
          WHERE user_id = ? AND platform = 'web' LIMIT 1`,
      )
        .bind(userId)
        .first<{ status: string; expires_at: number | null }>(),
    ).catch(() => null);

    const activeBillingExpiry =
      billing?.status === "active" ? billing.expires_at : undefined;
    let target = expiresAt;
    if (activeBillingExpiry === null)
      target = expiresAt; // already lifetime
    else if (typeof activeBillingExpiry === "number")
      target = Math.max(target, activeBillingExpiry);

    // Preserve any longer existing premium term represented in cache/legacy data.
    if (row.tier === "PREMIUM") {
      if (row.pro_expires_at == null) {
        await syncBillingEntitlement(env, userId, true, null);
        await syncUserPremiumCache(env, userId);
        return { ok: true, permanent: true };
      }
      if (row.pro_expires_at >= target) target = row.pro_expires_at;
    }

    if (
      billing?.status === "active" &&
      (activeBillingExpiry === null ||
        (typeof activeBillingExpiry === "number" &&
          activeBillingExpiry >= target))
    ) {
      await syncBillingEntitlement(
        env,
        userId,
        true,
        activeBillingExpiry ?? null,
      );
      await syncUserPremiumCache(env, userId);
      return { ok: true, permanent: (activeBillingExpiry ?? null) === null };
    }

    return setProStatus(env, { userId }, true, target);
  } catch (err) {
    logger.error("[flutterwave] ensureProCoverage failed", {
      error: describeError(err),
    });
    return { ok: false, permanent: false };
  }
}

export async function setProStatus(
  env: Env,
  identifier: { email?: string; userId?: string },
  isPro: boolean,
  expiresAt?: number | null,
): Promise<ProStatusResult> {
  try {
    const now = Date.now();
    let userId = identifier.userId ?? null;

    if (!userId && identifier.email) {
      const row = await retryTransient(() =>
        env.DB.prepare("SELECT id FROM users WHERE email_norm = ? LIMIT 1")
          .bind(normalizeEmail(identifier.email!))
          .first<{ id: string }>(),
      );
      userId = row?.id ?? null;
    }

    if (!userId) {
      logger.warn("[flutterwave] setProStatus could not resolve a user", {
        email: identifier.email ?? null,
      });
      return { ok: false, permanent: false };
    }

    await env.DB.prepare(
      `INSERT INTO user_subscriptions
         (user_id, status, product_id, platform, expires_at, created_at, updated_at)
       SELECT ?, ?, NULL, 'web', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
       ON CONFLICT (user_id) DO UPDATE SET
         status = excluded.status,
         platform = excluded.platform,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
      .bind(
        userId,
        isPro ? "active" : "inactive",
        isPro ? (expiresAt ?? null) : null,
        now,
        now,
        userId,
      )
      .run();

    await syncBillingEntitlement(
      env,
      userId,
      isPro,
      isPro ? (expiresAt ?? null) : null,
    );
    await syncUserPremiumCache(env, userId);

    return { ok: true, permanent: isPro && expiresAt == null };
  } catch (err) {
    logger.error("[flutterwave] setProStatus failed", {
      error: describeError(err),
    });
    return { ok: false, permanent: false };
  }
}

function parsePlanFromTxRef(txRef: string | null): BillingPlanPeriod | null {
  if (!txRef) return null;
  const match = txRef.match(/^ekwe_[a-f0-9-]+_(monthly|annual)_/);
  if (!match) return null;
  return match[1] as BillingPlanPeriod;
}

function userIdFromTxRef(txRef: string | null): string | null {
  const match = txRef?.match(/ekwe_([a-f0-9-]+)_/);
  return match ? match[1] : null;
}

type UserResolution =
  { kind: "found"; userId: string } | { kind: "missing" } | { kind: "error" };

async function resolveUserIdForClaim(
  env: Env,
  txRef: string | null,
  email: string | null,
): Promise<UserResolution> {
  try {
    const fromTxRef = userIdFromTxRef(txRef);
    if (fromTxRef) {
      const row = await retryTransient(() =>
        env.DB.prepare("SELECT id FROM users WHERE id = ?")
          .bind(fromTxRef)
          .first<{ id: string }>(),
      );
      if (row) return { kind: "found", userId: row.id };
    }

    if (!email) return { kind: "missing" };

    const row = await retryTransient(() =>
      env.DB.prepare("SELECT id FROM users WHERE email_norm = ?")
        .bind(normalizeEmail(email))
        .first<{ id: string }>(),
    );
    return row ? { kind: "found", userId: row.id } : { kind: "missing" };
  } catch (err) {
    logger.error("[flutterwave] Failed to resolve user id", {
      email,
      tx_ref: txRef,
      error: describeError(err),
    });
    return { kind: "error" };
  }
}

function planFromMeta(plan?: string): BillingPlanPeriod | null {
  if (plan === "ekwe_pro_monthly") return "monthly";
  if (plan === "ekwe_pro_annual") return "annual";
  return null;
}

async function verifyChargeAmount(
  env: Env,
  data: {
    amount?: number;
    currency?: string;
    tx_ref?: string | null;
    meta?: { amount?: number; currency?: string; plan?: string };
  },
): Promise<ChargeVerification> {
  const chargedAmount = data.amount;
  if (typeof chargedAmount !== "number") {
    logger.error("[flutterwave] charge.success without an amount", {
      tx_ref: data.tx_ref,
    });
    return { outcome: "reject" };
  }

  const chargedCurrency = (data.currency ?? "").toUpperCase();
  const plan =
    parsePlanFromTxRef(data.tx_ref ?? null) ?? planFromMeta(data.meta?.plan);

  if (!plan) {
    logger.error("[flutterwave] Unresolvable plan on charge.success", {
      tx_ref: data.tx_ref,
      meta_plan: data.meta?.plan,
    });
    return { outcome: "reject" };
  }

  if (resolvePaymentCurrency(chargedCurrency) !== chargedCurrency) {
    logger.error("[flutterwave] Unsupported currency on charge.success", {
      charged: chargedCurrency,
    });
    return { outcome: "reject" };
  }

  const prices = await getAuthoritativePlanPrices(env, chargedCurrency);
  if (!prices) {
    logger.warn("[flutterwave] Cannot confirm price from app_config", {
      currency: chargedCurrency,
    });
    return { outcome: "retry" };
  }

  const expected = plan === "annual" ? prices.annual : prices.monthly;

  const charged = toLowestUnit(chargedAmount, chargedCurrency);
  const wanted = toLowestUnit(expected, chargedCurrency);
  if (charged !== wanted) {
    logger.error("[flutterwave] Amount mismatch on charge.success", {
      charged: chargedAmount,
      expected,
      currency: chargedCurrency,
    });
    return { outcome: "reject" };
  }
  return { outcome: "ok" };
}

async function processFlutterwaveEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<ProviderResult> {
  const fwEvent = event as unknown as FlutterwaveEvent;
  const eventType = fwEvent.event || "unknown";
  const data = fwEvent.data;

  logger.info(`[flutterwave] Event: ${eventType}`, {
    id: fwEvent.id,
    tx_ref: data?.tx_ref,
    status: data?.status,
  });

  const baseEventKey = `flw:${fwEvent.id ?? "na"}:${eventType}`;
  const occurredAt = parseEventOccurredAt(fwEvent.created_at);

  const asRec = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  await recordProviderSnapshot(env, {
    recordType: "webhook",
    providerId: fwEvent.id,
    txRef: data?.tx_ref ?? null,
    flwRef: data?.flw_ref ?? null,
    userId: null,
    status: data?.status ?? eventType,
    amount: data?.amount ?? null,
    currency: data?.currency ?? null,
    payload: fwEvent,
    occurredAt,
  });

  if (eventType.startsWith("charge.") || eventType === "charge") {
    await upsertPaymentAttempt(env, {
      userId: null,
      txRef: data?.tx_ref ?? null,
      flwRef: data?.flw_ref ?? null,
      transactionId: data?.id != null ? String(data.id) : null,
      eventType,
      status: data?.status ?? "unknown",
      amount: data?.amount ?? null,
      currency: data?.currency ?? null,
      plan: planFromMeta(data?.meta?.plan),
      paymentType:
        typeof asRec(data).payment_type === "string"
          ? String(asRec(data).payment_type)
          : null,
      processorResponse:
        typeof asRec(data).processor_response === "string"
          ? String(asRec(data).processor_response)
          : null,
      customerEmail: data?.customer?.email ?? null,
      narrative:
        typeof asRec(data).narration === "string"
          ? String(asRec(data).narration)
          : null,
      raw: data ?? fwEvent,
      occurredAt,
    });
  }

  const record = async (
    status: BillingEventStatus,
    opts: {
      userId?: string | null;
      txRef?: string | null;
      flwRef?: string | null;
      amount?: number | null;
      currency?: string | null;
      plan?: string | null;
      message?: string | null;
      detail?: Record<string, unknown> | null;
      eventKey?: string;
    } = {},
  ) => {
    await recordBillingEvent(env, {
      provider: "flutterwave",
      eventKey: opts.eventKey ?? baseEventKey,
      eventType,
      status,
      userId: opts.userId ?? null,
      txRef: opts.txRef ?? data?.tx_ref ?? null,
      flwRef: opts.flwRef ?? data?.flw_ref ?? null,
      externalId: fwEvent.id,
      amount:
        typeof opts.amount === "number"
          ? opts.amount
          : typeof data?.amount === "number"
            ? data.amount
            : null,
      currency: opts.currency ?? data?.currency ?? null,
      plan: opts.plan ?? planFromMeta(data?.meta?.plan) ?? null,
      platform: "web",
      message: opts.message ?? null,
      detail: opts.detail ?? null,
      occurredAt,
    });
  };

  if (!data) {
    logger.warn("[flutterwave] Missing event data");
    await record("ignored", { message: "Missing event data" });
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  const email = data.customer?.email ?? null;
  const txRef = data.tx_ref ?? null;
  const resolution = await resolveUserIdForClaim(env, txRef, email);

  if (resolution.kind === "error") {
    await record("pending", {
      message: "User resolution failed; retryable",
      detail: { resolution: "error" },
    });
    return {
      response: Response.json({ received: true, action: "unverified" }),
      fullyApplied: false,
    };
  }

  if (resolution.kind === "missing") {
    logger.warn("[flutterwave] Could not resolve user from event", {
      email,
      tx_ref: txRef,
    });
    await record("ignored", {
      message: "Could not resolve user for event",
      detail: { resolution: "missing", customerEmailPresent: !!email },
    });
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  const userId = resolution.userId;

  if (eventType === "charge.success" && data.status === "successful") {
    const verification = await verifyChargeAmount(env, data);
    if (verification.outcome === "reject") {
      await record("rejected", {
        userId,
        message: "Charge verification rejected",
      });
      return {
        response: Response.json({ received: true, action: "rejected" }),
        fullyApplied: true,
      };
    }

    if (verification.outcome === "retry") {
      await record("pending", {
        userId,
        message: "Charge verification pending (pricing/config unavailable)",
      });
      return {
        response: Response.json({ received: true, action: "unverified" }),
        fullyApplied: false,
      };
    }

    const plan = parsePlanFromTxRef(txRef) ?? "monthly";
    const claim = await claimFlutterwaveTransaction(env, {
      flwRef: data.flw_ref,
      userId,
      txRef: txRef ?? "",
      amount: data.amount,
      currency: data.currency,
      period: plan,
    });

    if (!claim) {
      await record("pending", {
        userId,
        plan,
        message: "Failed to record claim; retryable",
      });
      return {
        response: Response.json({ received: true, action: "unverified" }),
        fullyApplied: false,
      };
    }

    if (!claim.shouldActivate) {
      logger.info("[flutterwave] Transaction already redeemed", {
        email,
        tx_ref: txRef,
        flw_ref: data.flw_ref,
      });
      const repaired = await ensureProCoverage(env, userId, claim.expiresAt);
      await record("succeeded", {
        userId,
        plan,
        message: "Charge already redeemed; coverage ensured",
        detail: { redeemed: true, coverageExpiresAt: claim.expiresAt },
      });
      return ackResult(
        Response.json({ received: true, action: "activated" }),
        repaired,
      );
    }

    const applied = await setProStatus(env, { userId }, true, claim.expiresAt);
    logger.info("[flutterwave] Subscription activated", {
      email,
      tx_ref: txRef,
      expires_at: claim.expiresAt,
    });
    await record(applied.ok ? "succeeded" : "pending", {
      userId,
      plan,
      message: applied.ok
        ? "Charge succeeded and access activated"
        : "Charge succeeded but access sync pending",
      detail: { expiresAt: claim.expiresAt, permanent: applied.permanent },
    });
    return ackResult(
      Response.json({ received: true, action: "activated" }),
      applied,
    );
  }

  if (eventType === "charge.refund" || eventType === "charge.refunded") {
    const rd = asRec(data);
    await upsertRefund(env, {
      providerRefundId:
        idStr(rd.refund_id) ?? idStr(rd.id) ?? String(fwEvent.id),
      transactionId:
        idStr(rd.transaction_id) ?? (data?.id != null ? String(data.id) : null),
      txRef,
      flwRef: data?.flw_ref ?? null,
      userId,
      amountRefunded:
        typeof rd.amount_refunded === "number"
          ? rd.amount_refunded
          : typeof data?.amount === "number"
            ? data.amount
            : null,
      currency: data?.currency ?? null,
      status: data?.status ?? "unknown",
      reason: typeof rd.reason === "string" ? rd.reason : null,
      raw: data ?? fwEvent,
      occurredAt,
    });
    if (data.status === "successful" || data.status === "completed") {
      const applied = await setProStatus(env, { userId }, false, null);
      logger.info("[flutterwave] Charge refunded — paid plan revoked", {
        email,
        tx_ref: txRef,
      });
      await record(applied.ok ? "refunded" : "pending", {
        userId,
        message: applied.ok
          ? "Charge refunded; billing access revoked"
          : "Charge refund received but access update pending",
      });
      return ackResult(
        Response.json({ received: true, action: "deactivated" }),
        applied,
      );
    }
    await record("ignored", {
      userId,
      message: `Refund event ignored (status=${data.status ?? "unknown"})`,
    });
    return {
      response: Response.json({ received: true, action: "ignored" }),
      fullyApplied: true,
    };
  }

  if (eventType === "invoice.updated") {
    const renewedUntil = parseEndDate(data.subscription?.end_date);
    if (renewedUntil) {
      const applied = await setProStatus(env, { userId }, true, renewedUntil);
      logger.info("[flutterwave] Subscription renewed via invoice", {
        email,
        tx_ref: txRef,
      });
      await record(applied.ok ? "succeeded" : "pending", {
        userId,
        message: "Subscription renewed via invoice",
        detail: { expiresAt: renewedUntil },
      });
      return ackResult(
        Response.json({ received: true, action: "renewed" }),
        applied,
      );
    }
    logger.warn("[flutterwave] invoice.updated carried no usable end_date", {
      email,
      tx_ref: txRef,
      end_date: data.subscription?.end_date ?? null,
    });
    await record("ignored", {
      userId,
      message: "Invoice update without usable end date",
    });
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  if (eventType === "subscription.paused") {
    const applied = await setProStatus(env, { userId }, false, null);
    logger.info("[flutterwave] Subscription paused", { email, tx_ref: txRef });
    await record(applied.ok ? "cancelled" : "pending", {
      userId,
      message: "Subscription paused",
    });
    return ackResult(
      Response.json({ received: true, action: "deactivated" }),
      applied,
    );
  }

  if (
    eventType === "subscription.completed" ||
    eventType === "subscription.cancelled"
  ) {
    const retainedUntil = parseEndDate(data.subscription?.end_date);
    if (!retainedUntil) {
      logger.warn("[flutterwave] Retention event without a usable end_date", {
        event: eventType,
        email,
        tx_ref: txRef,
      });
      await record("ignored", {
        userId,
        message: "Subscription end event without usable end date",
      });
      return {
        response: Response.json({ received: true, action: "skipped" }),
        fullyApplied: true,
      };
    }

    const stillRunning = retainedUntil > Date.now();
    const applied = stillRunning
      ? await setProStatus(env, { userId }, true, retainedUntil)
      : await setProStatus(env, { userId }, false, null);
    logger.info("[flutterwave] Subscription ended (retained until expiry)", {
      event: eventType,
      email,
      tx_ref: txRef,
      expires_at: retainedUntil,
    });
    await record(
      applied.ok ? (stillRunning ? "succeeded" : "cancelled") : "pending",
      {
        userId,
        message: stillRunning
          ? "Subscription ending; access retained until expiry"
          : "Subscription ended",
        detail: { expiresAt: retainedUntil },
      },
    );
    return ackResult(
      Response.json({ received: true, action: "retained" }),
      applied,
    );
  }

  if (eventType === "subscription.expired") {
    const applied = await setProStatus(env, { userId }, false, null);
    logger.info("[flutterwave] Subscription expired", {
      email,
      tx_ref: txRef,
    });
    await record(applied.ok ? "expired" : "pending", {
      userId,
      message: "Subscription expired",
    });
    return ackResult(
      Response.json({ received: true, action: "deactivated" }),
      applied,
    );
  }

  if (eventType.includes("dispute") || eventType.includes("chargeback")) {
    const dd = asRec(data);
    const disputeId =
      idStr(dd.id) ?? idStr(dd.dispute_id) ?? String(fwEvent.id);
    await upsertDispute(env, {
      providerDisputeId: disputeId,
      transactionId:
        idStr(dd.transaction_id) ?? (data?.id != null ? String(data.id) : null),
      txRef,
      flwRef: data?.flw_ref ?? null,
      userId,
      amount:
        typeof data?.amount === "number"
          ? data.amount
          : typeof dd.amount_disputed === "number"
            ? dd.amount_disputed
            : null,
      currency: data?.currency ?? null,
      status:
        typeof data?.status === "string"
          ? data.status
          : typeof dd.stage === "string"
            ? dd.stage
            : "unknown",
      stage: typeof dd.stage === "string" ? dd.stage : null,
      reason:
        typeof dd.reason === "string"
          ? dd.reason
          : typeof dd.narration === "string"
            ? dd.narration
            : null,
      raw: data ?? fwEvent,
      occurredAt,
    });
    await record("pending", {
      userId,
      message: `Dispute/chargeback event recorded: ${eventType}`,
      detail: { disputeId },
    });
    return {
      response: Response.json({ received: true, action: "recorded" }),
      fullyApplied: true,
    };
  }

  const statusMap: Record<string, BillingEventStatus> = {
    "charge.failed": "failed",
    "charge.abandoned": "failed",
    "invoice.payment_failed": "failed",
    "transfer.failed": "failed",
    "transfer.reversed": "failed",
    "charge.pending": "pending",
    "charge.initiated": "pending",
    "transfer.completed": "succeeded",
  };

  if (eventType in statusMap) {
    const mapped = statusMap[eventType];
    logger.info(`[flutterwave] Event recorded: ${eventType} -> ${mapped}`);
    await record(mapped, {
      userId,
      message: `Flutterwave event: ${eventType}`,
    });
    return {
      response: Response.json({ received: true, action: "recorded" }),
      fullyApplied: true,
    };
  }

  logger.warn(`[flutterwave] Unhandled event type: ${eventType}`);
  await record("unknown", {
    userId,
    message: `Unhandled event type: ${eventType}`,
  });
  return {
    response: Response.json({ received: true, action: "unknown" }),
    fullyApplied: true,
  };
}

registerProvider("flutterwave", {
  enabled: (env) => !!env.FLUTTERWAVE_WEBHOOK_SECRET,
  process: processFlutterwaveEvent,
});

const FLUTTERWAVE_USER_AGENT = `Ekwe-Worker/${APP_VERSION} (https://ekwe.app)`;

export async function fetchRecentSuccessfulTransactions(
  env: Env,
  daysAgo: number = 2,
): Promise<FlwTransactionsResponse["data"]> {
  if (!env.FLUTTERWAVE_SECRET) {
    throw new Error("FLUTTERWAVE_SECRET not configured");
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysAgo);
  const fromIso = fromDate.toISOString().split("T")[0];

  let allTransactions: FlwTransactionsResponse["data"] = [];
  let currentPage = 1;
  let totalPages: number;

  const FLW_MAX_ATTEMPTS = 3;
  async function fetchPageWithRetry(url: string): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= FLW_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchWithTimeout(
          url,
          {
            headers: {
              Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": FLUTTERWAVE_USER_AGENT,
            },
          },
          TIMEOUT_FAST,
        );
        if (res.ok) return res;
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) {
          throw new Error(`Flutterwave API error: ${res.status}`);
        }
        lastErr = new Error(`Flutterwave API error: ${res.status}`);
        if (attempt === FLW_MAX_ATTEMPTS) throw lastErr;
        const retryAfter = res.headers.get("retry-after");
        const backoffMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000 || 0, 10_000)
          : jitteredBackoffMs(attempt, 5_000);
        logger.warn("[reconciliation] Flutterwave transient error, retrying", {
          status: res.status,
          attempt,
          backoffMs,
        });
        if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.startsWith("Flutterwave API error:") &&
          !/error: (429|5\d\d)/.test(e.message)
        ) {
          throw e;
        }
        lastErr = e;
        if (attempt === FLW_MAX_ATTEMPTS) throw e;
        const backoffMs = jitteredBackoffMs(attempt, 5_000);
        logger.warn("[reconciliation] Flutterwave fetch failed, retrying", {
          attempt,
          error: String(e),
        });
        if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastErr;
  }

  do {
    const url = `https://api.flutterwave.com/v3/transactions?status=successful&from=${fromIso}&page=${currentPage}`;
    const res = await fetchPageWithRetry(url);

    const payload: FlwTransactionsResponse = await res.json();
    if (payload.status === "success" && Array.isArray(payload.data)) {
      allTransactions = allTransactions.concat(payload.data);
      totalPages = payload.meta?.page_info?.total_pages ?? 1;
    } else {
      break;
    }
    currentPage++;
  } while (currentPage <= totalPages);

  return allTransactions;
}

export async function getMissingTransactions(
  env: Env,
  flwRefs: string[],
): Promise<string[]> {
  if (flwRefs.length === 0) return [];

  try {
    const existingRefs = new Set<string>();
    const chunkSize = 90;

    for (let i = 0; i < flwRefs.length; i += chunkSize) {
      const chunk = flwRefs.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await retryTransient(() =>
        env.DB.prepare(
          `SELECT flw_ref FROM flutterwave_claims WHERE flw_ref IN (${placeholders})`,
        )
          .bind(...chunk)
          .all<{ flw_ref: string }>(),
      );
      for (const row of rows.results) existingRefs.add(row.flw_ref);
    }

    return flwRefs.filter((ref) => !existingRefs.has(ref));
  } catch (err) {
    throw new Error(
      `[reconciliation] Failed to fetch missing transactions: ${describeError(err)}`,
      { cause: err },
    );
  }
}

export async function processMissingTransaction(
  env: Env,
  data: FlutterwaveEvent["data"],
): Promise<boolean> {
  const email = data.customer?.email ?? null;
  const txRef = data.tx_ref ?? null;

  if (data.status !== "successful") return false;

  const verification = await verifyChargeAmount(env, data);
  if (verification.outcome !== "ok") {
    logger.warn("[reconciliation] Transaction amount verification failed", {
      tx_ref: txRef,
      outcome: verification.outcome,
    });
    return false;
  }

  const plan = parsePlanFromTxRef(txRef);
  const period = plan ?? "monthly";

  const resolution = await resolveUserIdForClaim(env, txRef, email);
  if (resolution.kind !== "found") {
    logger.warn("[reconciliation] No user id to attribute transaction to", {
      email,
      tx_ref: txRef,
      flw_ref: data.flw_ref,
      outcome: resolution.kind,
    });
    return false;
  }

  const { userId } = resolution;

  const claim = await claimFlutterwaveTransaction(env, {
    flwRef: data.flw_ref ?? "",
    userId,
    txRef: txRef ?? "",
    amount: data.amount ?? 0,
    currency: data.currency ?? "",
    period,
  });

  if (!claim) {
    logger.error("[reconciliation] Claim failed; will retry", {
      tx_ref: txRef,
      flw_ref: data.flw_ref,
    });
    return false;
  }

  if (!claim.shouldActivate) {
    const repaired = await ensureProCoverage(env, userId, claim.expiresAt);
    await recordBillingEvent(env, {
      provider: "flutterwave",
      eventKey: `flw:reconcile:${data.flw_ref ?? txRef ?? "unknown"}:charge.success`,
      eventType: "charge.success",
      status: repaired.ok ? "succeeded" : "pending",
      userId,
      txRef,
      flwRef: data.flw_ref ?? null,
      externalId: data.id ?? null,
      amount: data.amount ?? null,
      currency: data.currency ?? null,
      plan: period,
      platform: "web",
      message: repaired.ok
        ? "Reconciliation ensured coverage for redeemed transaction"
        : "Reconciliation found redeemed transaction but access sync pending",
      detail: { source: "reconciliation", expiresAt: claim.expiresAt },
    });
    logger.info("[reconciliation] Transaction already redeemed", {
      email,
      tx_ref: txRef,
      flw_ref: data.flw_ref,
      repaired: repaired.ok,
    });
    return repaired.ok;
  }

  const applied = await setProStatus(env, { userId }, true, claim.expiresAt);
  await recordBillingEvent(env, {
    provider: "flutterwave",
    eventKey: `flw:reconcile:${data.flw_ref ?? txRef ?? "unknown"}:charge.success`,
    eventType: "charge.success",
    status: applied.ok ? "succeeded" : "pending",
    userId,
    txRef,
    flwRef: data.flw_ref ?? null,
    externalId: data.id ?? null,
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    plan: period,
    platform: "web",
    message: applied.ok
      ? "Transaction reconciled and access activated"
      : "Transaction reconciled but access sync pending",
    detail: { source: "reconciliation", expiresAt: claim.expiresAt },
  });
  if (applied.ok) {
    logger.info("[reconciliation] Successfully processed missing transaction", {
      email,
      tx_ref: txRef,
    });
  }
  return applied.ok;
}

export async function reconcileFlutterwaveTransactions(
  env: Env,
  processFn: (
    env: Env,
    tx: FlutterwaveEvent["data"],
  ) => Promise<boolean> = processMissingTransaction,
  options?: { enqueueOnFailure?: boolean; daysAgo?: number },
): Promise<void> {
  const enqueueOnFailure = options?.enqueueOnFailure ?? true;
  const daysAgo = options?.daysAgo ?? 2;
  if (!env.FLUTTERWAVE_SECRET) {
    logger.info("[reconciliation] Skipped: FLUTTERWAVE_SECRET not configured");
    return;
  }

  try {
    logger.info(
      "[reconciliation] Starting Flutterwave billing reconciliation...",
    );
    const transactions = await fetchRecentSuccessfulTransactions(env, daysAgo);
    if (transactions.length === 0) {
      logger.info("[reconciliation] No recent transactions found.");
      return;
    }

    const flwRefs = transactions.map((t) => t.flw_ref).filter(Boolean);
    const missingRefs = await getMissingTransactions(env, flwRefs);

    if (missingRefs.length === 0) {
      logger.info(
        "[reconciliation] All recent transactions are already in the ledger.",
      );
      return;
    }

    logger.info(
      `[reconciliation] Found ${missingRefs.length} missing transactions. Processing...`,
    );

    const txByRef = new Map(transactions.map((t) => [t.flw_ref, t]));

    let successCount = 0;
    let terminalFailures = 0;
    let retryableFailures = 0;
    for (const missingRef of missingRefs) {
      const tx = txByRef.get(missingRef);
      if (!tx) continue;

      try {
        const processed = await processFn(env, tx);
        if (processed) successCount++;
        else terminalFailures++;
      } catch (err) {
        retryableFailures++;
        logger.error(
          `[reconciliation] Failed to process missing ref ${missingRef}`,
          { error: describeError(err) },
        );
      }
    }

    if (successCount === 0 && retryableFailures > 0) {
      throw new Error(
        `[reconciliation] No transactions applied (${terminalFailures} terminal, ${retryableFailures} retryable) — left for the next sweep.`,
      );
    }
    if (retryableFailures > 0) {
      logger.warn(
        `[reconciliation] Reconciled ${successCount}/${missingRefs.length}; ` +
          `${retryableFailures} transient failure(s) left for the next sweep.`,
      );
    }

    logger.info(
      `[reconciliation] Completed processing. Successfully reconciled ${successCount}/${missingRefs.length} missing transactions.`,
    );
  } catch (err) {
    if (enqueueOnFailure && env.RECONCILIATION_QUEUE) {
      try {
        await env.RECONCILIATION_QUEUE.send({
          type: "flutterwave-reconcile",
          daysAgo,
          originalAt: new Date().toISOString(),
          attempt: 1,
        });
        logger.warn("[reconciliation] Enqueued for queue retry", { daysAgo });
      } catch (qErr) {
        logger.warn("[reconciliation] Failed to enqueue retry", {
          error: qErr instanceof Error ? qErr.message : String(qErr),
        });
      }
    }
    throw err;
  }
}

export async function fetchFlutterwaveCollection(
  env: Env,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<unknown[] | null> {
  if (!env.FLUTTERWAVE_SECRET) return null;
  const url = new URL(`https://api.flutterwave.com/v3${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  try {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers: { Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}` },
      },
      TIMEOUT_FAST,
    );
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      data?: unknown;
    } | null;
    if (!res.ok || body?.status !== "success") return null;
    const data = body.data;
    if (Array.isArray(data)) return (data as unknown[]).slice();
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      const maybe = rec.data;
      if (Array.isArray(maybe)) return (maybe as unknown[]).slice();
      return [data];
    }
    return [];
  } catch (e) {
    logger.warn("[flutterwave] collection fetch failed", {
      path,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function idStr(v: unknown): string | null {
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
    const s = String(v).trim();
    return s ? s : null;
  }
  return null;
}

function parseMaybeDate(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export async function syncFlutterwaveBillingData(
  env: Env,
  options?: { days?: number },
): Promise<{
  transactions: number;
  refunds: number;
  disputes: number;
  errors: string[];
}> {
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.min(options?.days ?? 7, 30));
  const from = new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  let txCount = 0;
  let refundCount = 0;
  let disputeCount = 0;

  const collected: unknown[] = [];
  const successful = await fetchFlutterwaveCollection(env, "/transactions", {
    from,
    to,
    status: "successful",
  });
  if (successful) collected.push(...successful);
  const all = await fetchFlutterwaveCollection(env, "/transactions", {
    from,
    to,
  });
  if (all) collected.push(...all);

  const seenTx = new Set<string>();
  for (const raw of collected) {
    const tx = asObj(raw);
    const txRef = typeof tx.tx_ref === "string" ? tx.tx_ref : null;
    const flwRef = typeof tx.flw_ref === "string" ? tx.flw_ref : null;
    const id = idStr(tx.id);
    const dedupe = id ?? txRef ?? flwRef;
    if (dedupe && seenTx.has(dedupe)) continue;
    if (dedupe) seenTx.add(dedupe);

    const status = typeof tx.status === "string" ? tx.status : "unknown";
    const amount = typeof tx.amount === "number" ? tx.amount : null;
    const currency = typeof tx.currency === "string" ? tx.currency : null;
    const customer = asObj(tx.customer);
    const email = typeof customer.email === "string" ? customer.email : null;
    const meta = asObj(tx.meta);
    const metaUserId = typeof meta.user_id === "string" ? meta.user_id : null;
    let userId = metaUserId;
    if (!userId) {
      const resolution = await resolveUserIdForClaim(env, txRef, email);
      if (resolution.kind === "found") userId = resolution.userId;
    }

    const occurredAt = parseMaybeDate(tx.created_at);
    const plan =
      (typeof meta.plan === "string" ? meta.plan : null) ??
      parsePlanFromTxRef(txRef);

    await recordProviderSnapshot(env, {
      recordType: "transaction",
      providerId: id,
      txRef,
      flwRef,
      userId,
      status,
      amount,
      currency,
      payload: raw,
      occurredAt,
    });
    await upsertPaymentAttempt(env, {
      userId,
      txRef,
      flwRef,
      transactionId: id,
      eventType: "transaction.sync",
      status,
      amount,
      currency,
      plan,
      paymentType: typeof tx.payment_type === "string" ? tx.payment_type : null,
      processorResponse:
        typeof tx.processor_response === "string"
          ? tx.processor_response
          : null,
      customerEmail: email,
      narrative: typeof tx.narration === "string" ? tx.narration : null,
      raw,
      occurredAt,
    });
    await recordBillingEvent(env, {
      provider: "flutterwave",
      eventKey: `sync:tx:${id ?? txRef ?? crypto.randomUUID()}:${status}`,
      eventType: "transaction.sync",
      status:
        status === "successful"
          ? "succeeded"
          : status === "pending" || status === "new"
            ? "pending"
            : status === "failed"
              ? "failed"
              : "unknown",
      userId,
      txRef,
      flwRef,
      externalId: id,
      amount,
      currency,
      plan,
      message: "Synced from Flutterwave transactions API",
      detail: { source: "sync" },
      occurredAt,
    });
    txCount++;
  }

  const refunds = await fetchFlutterwaveCollection(env, "/refunds", {
    from,
    to,
  });
  if (refunds) {
    for (const raw of refunds) {
      const r = asObj(raw);
      const txRef = typeof r.tx_ref === "string" ? r.tx_ref : null;
      const flwRef = typeof r.flw_ref === "string" ? r.flw_ref : null;
      const refundId = idStr(r.id);
      const txId = idStr(r.transaction_id);
      const resolution = await resolveUserIdForClaim(env, txRef, null);
      const userId = resolution.kind === "found" ? resolution.userId : null;
      const amountRefunded =
        typeof r.amount_refunded === "number"
          ? r.amount_refunded
          : typeof r.amount === "number"
            ? r.amount
            : null;
      await recordProviderSnapshot(env, {
        recordType: "refund",
        providerId: refundId,
        txRef,
        flwRef,
        userId,
        status: typeof r.status === "string" ? r.status : null,
        amount: amountRefunded,
        currency: typeof r.currency === "string" ? r.currency : null,
        payload: raw,
        occurredAt: parseMaybeDate(r.created_at),
      });
      await upsertRefund(env, {
        providerRefundId: refundId,
        transactionId: txId,
        txRef,
        flwRef,
        userId,
        amountRefunded,
        currency: r.currency,
        status: r.status,
        reason: typeof r.reason === "string" ? r.reason : null,
        raw,
        occurredAt: parseMaybeDate(r.created_at),
      });
      refundCount++;
    }
  } else {
    errors.push("refunds_unavailable_or_forbidden");
  }

  const disputes = await fetchFlutterwaveCollection(env, "/disputes", {
    from,
    to,
  });
  if (disputes) {
    for (const raw of disputes) {
      const d = asObj(raw);
      const disputeId = idStr(d.id);
      if (!disputeId) continue;
      const txRef = typeof d.tx_ref === "string" ? d.tx_ref : null;
      const txId = idStr(d.transaction_id);
      const resolution = await resolveUserIdForClaim(env, txRef, null);
      const userId = resolution.kind === "found" ? resolution.userId : null;
      await recordProviderSnapshot(env, {
        recordType: "dispute",
        providerId: disputeId,
        txRef,
        flwRef: typeof d.flw_ref === "string" ? d.flw_ref : null,
        userId,
        status: typeof d.status === "string" ? d.status : null,
        amount: typeof d.amount === "number" ? d.amount : null,
        currency: typeof d.currency === "string" ? d.currency : null,
        payload: raw,
        occurredAt: parseMaybeDate(d.created_at),
      });
      await upsertDispute(env, {
        providerDisputeId: disputeId,
        transactionId: txId,
        txRef,
        flwRef: typeof d.flw_ref === "string" ? d.flw_ref : null,
        userId,
        amount: d.amount,
        currency: d.currency,
        status: d.status,
        stage: typeof d.stage === "string" ? d.stage : null,
        reason:
          typeof d.reason === "string"
            ? d.reason
            : typeof d.narration === "string"
              ? d.narration
              : null,
        raw,
        occurredAt: parseMaybeDate(d.created_at),
      });
      disputeCount++;
    }
  } else {
    errors.push("disputes_unavailable_or_forbidden");
  }

  return {
    transactions: txCount,
    refunds: refundCount,
    disputes: disputeCount,
    errors,
  };
}
