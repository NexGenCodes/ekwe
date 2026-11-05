import { APP_VERSION, WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { registerProvider, ProviderResult } from "@/services/billing";
import { claimFlutterwaveTransaction } from "@/services/flutterwave-claim";
import { describeError, retryTransient } from "@/db/retry";
import { normalizeEmail } from "@ekwe/shared";
import { toLowestUnit, resolvePaymentCurrency } from "@ekwe/shared/money";
import { getAuthoritativePlanPrices } from "@/routes/pricing";

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
      env.DB.prepare("SELECT tier, pro_expires_at FROM users WHERE id = ?")
        .bind(userId)
        .first<{ tier: string; pro_expires_at: number | null }>(),
    );

    if (!row) return { ok: false, permanent: false };

    if (
      row.tier === "PREMIUM" &&
      (row.pro_expires_at === null || row.pro_expires_at >= expiresAt)
    ) {
      return { ok: true, permanent: row.pro_expires_at === null };
    }

    return setProStatus(env, { userId }, true, expiresAt);
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

    // Absolute set, so a retry lands on the same state.
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET tier = ?, pro_expires_at = ?, updated_at = ? WHERE id = ?",
      ).bind(
        isPro ? "PREMIUM" : "FREE",
        isPro ? (expiresAt ?? null) : null,
        now,
        userId,
      ),
      env.DB.prepare(
        `INSERT INTO user_subscriptions
           (user_id, status, product_id, platform, expires_at, created_at, updated_at)
         SELECT ?, ?, NULL, 'web', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
         ON CONFLICT (user_id) DO UPDATE SET
           status = excluded.status,
           platform = excluded.platform,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      ).bind(
        userId,
        isPro ? "active" : "inactive",
        isPro ? (expiresAt ?? null) : null,
        now,
        now,
        userId,
      ),
    ]);

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
  const resolution = await resolveUserIdForClaim(env, txRef, email);

  if (resolution.kind === "error") {
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
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  const userId = resolution.userId;

  if (eventType === "charge.success" && data.status === "successful") {
    const verification = await verifyChargeAmount(env, data);
    if (verification.outcome === "reject") {
      return {
        response: Response.json({ received: true, action: "rejected" }),
        fullyApplied: true,
      };
    }

    if (verification.outcome === "retry") {
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
    return ackResult(
      Response.json({ received: true, action: "activated" }),
      applied,
    );
  }

  if (eventType === "charge.refund" || eventType === "charge.refunded") {
    if (data.status === "successful" || data.status === "completed") {
      const applied = await setProStatus(env, { userId }, false, null);
      logger.info("[flutterwave] Charge refunded — paid plan revoked", {
        email,
        tx_ref: txRef,
      });
      return ackResult(
        Response.json({ received: true, action: "deactivated" }),
        applied,
      );
    }
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
    return {
      response: Response.json({ received: true, action: "skipped" }),
      fullyApplied: true,
    };
  }

  if (eventType === "subscription.paused") {
    const applied = await setProStatus(env, { userId }, false, null);
    logger.info("[flutterwave] Subscription paused", {
      email,
      tx_ref: txRef,
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
    return ackResult(
      Response.json({ received: true, action: "deactivated" }),
      applied,
    );
  }

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

  logger.warn(`[flutterwave] Unhandled event type: ${eventType}`);
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

  do {
    const url = `https://api.flutterwave.com/v3/transactions?status=successful&from=${fromIso}&page=${currentPage}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": FLUTTERWAVE_USER_AGENT,
      },
    });

    if (!res.ok) {
      throw new Error(`Flutterwave API error: ${res.status}`);
    }

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
    logger.info("[reconciliation] Transaction already redeemed", {
      email,
      tx_ref: txRef,
      flw_ref: data.flw_ref,
      repaired: repaired.ok,
    });
    return repaired.ok;
  }

  const applied = await setProStatus(env, { userId }, true, claim.expiresAt);
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
): Promise<void> {
  if (!env.FLUTTERWAVE_SECRET) {
    logger.info("[reconciliation] Skipped: FLUTTERWAVE_SECRET not configured");
    return;
  }

  try {
    logger.info(
      "[reconciliation] Starting Flutterwave billing reconciliation...",
    );
    const transactions = await fetchRecentSuccessfulTransactions(env, 2);
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
        `[reconciliation] No transactions applied (${terminalFailures} terminal, ${retryableFailures} retryable). Triggering queue retry.`,
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
    logger.error("[reconciliation] Flutterwave reconciliation job failed", {
      error: String(err),
    });
    throw err;
  }
}
