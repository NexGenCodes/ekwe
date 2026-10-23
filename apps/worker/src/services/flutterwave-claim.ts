import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { describeError, retryTransient } from "@/db/retry";
import type { BillingPlanPeriod } from "@/services/flutterwave";

export interface FlutterwaveClaim {
  /** Epoch milliseconds; the period this `flw_ref` bought. */
  expiresAt: number;
  shouldActivate: boolean;
}

const PLAN_MS: Record<BillingPlanPeriod, number> = {
  monthly: 30 * 86_400_000,
  annual: 365 * 86_400_000,
};

/**
 * Records a transaction and returns the expiry it bought. The insert is a
 * single statement, so a concurrent redemption sees the earlier claim's
 * expiry instead of extending from the same stale base.
 */
export async function claimFlutterwaveTransaction(
  env: Env,
  input: {
    flwRef: string;
    userId: string;
    txRef: string;
    amount: number;
    currency: string;
    period: BillingPlanPeriod;
  },
): Promise<FlutterwaveClaim | null> {
  const now = Date.now();
  const graceMs = PLAN_MS[input.period];

  try {
    const inserted = await retryTransient(() =>
      env.DB.prepare(
        `INSERT INTO flutterwave_claims
           (flw_ref, user_id, tx_ref, amount, currency, expires_at, claimed_at)
         SELECT ?, ?, ?, ?, ?,
           MAX(
             ?,
             COALESCE((
               SELECT MAX(expires_at) FROM user_subscriptions
                WHERE user_id = ? AND status = 'active' AND expires_at IS NOT NULL
             ), 0),
             COALESCE((SELECT pro_expires_at FROM users WHERE id = ?), 0),
             COALESCE((SELECT MAX(expires_at) FROM flutterwave_claims WHERE user_id = ?), 0)
           ) + ?,
           ?
         ON CONFLICT (flw_ref) DO NOTHING
         RETURNING expires_at`,
      )
        .bind(
          input.flwRef,
          input.userId,
          input.txRef,
          input.amount,
          input.currency,
          now,
          input.userId,
          input.userId,
          input.userId,
          graceMs,
          now,
        )
        .all<{ expires_at: number }>(),
    );

    const row = inserted.results[0];
    if (row) return { expiresAt: row.expires_at, shouldActivate: true };

    const existing = await retryTransient(() =>
      env.DB.prepare(
        "SELECT expires_at FROM flutterwave_claims WHERE flw_ref = ?",
      )
        .bind(input.flwRef)
        .first<{ expires_at: number }>(),
    );

    if (!existing) {
      logger.error("[billing/claim] Missing claim after conflict", {
        flw_ref: input.flwRef,
      });
      return null;
    }

    return { expiresAt: existing.expires_at, shouldActivate: false };
  } catch (error) {
    logger.error("[billing/claim] Claim failed", {
      flw_ref: input.flwRef,
      error: describeError(error),
    });
    return null;
  }
}
