import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { describeError } from "@/db/retry";
import {
  HISTORY_TTL_FREE_DAYS,
  HISTORY_TTL_PAID_DAYS,
  HISTORY_TOMBSTONES_RETENTION_DAYS,
} from "@ekwe/shared/retention";
import { REFRESH_TOKEN_TTL_SECONDS, utcDay } from "@ekwe/shared";
import { d1Cleanup } from "@/services/d1-cache";
import { purgeExpiredSpeechCache } from "@/services/speech";
import { reconcileFlutterwaveTransactions } from "@/services/flutterwave";
import { deleteAccount } from "@/auth/users";

const DAY_MS = 86_400_000;
const USAGE_RETENTION_DAYS = 7;
const CLAIM_RETENTION_DAYS = 90;
// Push-token retention: remove inactive tokens after 30 days.
const PUSH_TOKEN_RETENTION_DAYS = 30;
const CACHE_TABLES = [
  "cache_translation",
  "cache_transcription",
  "cache_lang",
  "webhook_idempotency",
] as const;

async function cleanupExpiredHistory(env: Env): Promise<number> {
  const now = Date.now();
  const freeCutoff = now - HISTORY_TTL_FREE_DAYS * DAY_MS;
  const paidCutoff = now - HISTORY_TTL_PAID_DAYS * DAY_MS;

  const proClause = `EXISTS (
    SELECT 1 FROM user_subscriptions us
     WHERE us.user_id = history.user_id
       AND us.status = 'active'
       AND (us.expires_at IS NULL OR us.expires_at > ?)
  )`;

  const [free, paid] = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM history
        WHERE created_at < ? AND deleted_at IS NULL AND NOT ${proClause}`,
    ).bind(freeCutoff, now),
    env.DB.prepare(
      `DELETE FROM history
        WHERE created_at < ? AND deleted_at IS NULL AND ${proClause}`,
    ).bind(paidCutoff, now),
  ]);

  return (free.meta.changes ?? 0) + (paid.meta.changes ?? 0);
}

export async function purgeTombstones(env: Env): Promise<number> {
  const cutoff = Date.now() - HISTORY_TOMBSTONES_RETENTION_DAYS * DAY_MS;
  const result = await env.DB.prepare(
    "DELETE FROM history WHERE deleted_at IS NOT NULL AND deleted_at < ?",
  )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Auth rows are append-only by design (rotation history is evidence), so they
 * need explicit retention. Rotations older than the refresh TTL can no longer
 * be presented by any client.
 */
export async function cleanupAuthState(env: Env): Promise<number> {
  const now = Date.now();
  const rotationCutoff = now - (REFRESH_TOKEN_TTL_SECONDS + 86_400) * 1000;
  const otpCutoff = now - DAY_MS;

  const [rotations, sessions, otps] = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM session_rotations
        WHERE issued_at < ?
           OR session_id IN (
                SELECT id FROM sessions
                 WHERE expires_at <= ? OR revoked_at IS NOT NULL
              )`,
    ).bind(rotationCutoff, now),
    env.DB.prepare(
      "DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL",
    ).bind(now),
    env.DB.prepare("DELETE FROM otp_codes WHERE expires_at < ?").bind(
      otpCutoff,
    ),
  ]);

  return (
    (rotations.meta.changes ?? 0) +
    (sessions.meta.changes ?? 0) +
    (otps.meta.changes ?? 0)
  );
}

/**
 * Daily usage is kept a week so support can explain a limit after the fact.
 * The active day and the six before it are all `/usage` can ever need.
 */
export async function cleanupDailyUsage(env: Env): Promise<number> {
  const cutoff = utcDay(Date.now() - USAGE_RETENTION_DAYS * DAY_MS);
  const result = await env.DB.prepare(
    "DELETE FROM user_daily_usage WHERE day < ?",
  )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

/** Monthly rows are support evidence for a year, then reclaimable. */
export async function cleanupMonthlyUsage(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - 370 * DAY_MS).toISOString().slice(0, 7);
  const result = await env.DB.prepare(
    "DELETE FROM user_monthly_usage WHERE month < ?",
  )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

export async function cleanupBillingClaims(env: Env): Promise<number> {
  const cutoff = Date.now() - CLAIM_RETENTION_DAYS * DAY_MS;
  const result = await env.DB.prepare(
    "DELETE FROM flutterwave_claims WHERE expires_at < ?",
  )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Purge inactive push tokens. Cooldown state is now held in KV
 * with TTL-based expiry and no longer needs a D1 sweep.
 */
export async function cleanupSyncState(env: Env): Promise<number> {
  const cutoff = Date.now() - PUSH_TOKEN_RETENTION_DAYS * DAY_MS;
  const result = await env.DB.prepare(
    "DELETE FROM push_tokens WHERE is_active = 0 AND last_used_at < ?",
  )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

/** Hard-delete accounts whose scheduled deletion time has passed. */
export async function purgeScheduledDeletions(env: Env): Promise<number> {
  const now = Date.now();
  const rows = await env.DB.prepare(
    "SELECT id, email_norm FROM users WHERE delete_after IS NOT NULL AND delete_after <= ? LIMIT 50",
  )
    .bind(now)
    .all<{ id: string; email_norm: string }>();
  let purged = 0;
  for (const row of rows.results ?? []) {
    try {
      await deleteAccount(env, row.id);
      purged += 1;
      logger.info("[scheduled] purged scheduled deletion", {
        userId: row.id,
        emailNorm: row.email_norm,
      });
    } catch (error) {
      logger.error("[scheduled] scheduled deletion purge failed", {
        userId: row.id,
        error: describeError(error),
      });
    }
  }
  return purged;
}

async function runStep(
  name: string,
  step: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await step();
    logger.info(`[scheduled] ${name} completed`, { result });
  } catch (error) {
    logger.error(`[scheduled] ${name} failed`, {
      error: describeError(error),
    });
  }
}

export async function runMaintenance(env: Env): Promise<void> {
  await runStep("cache cleanup", async () => {
    for (const table of CACHE_TABLES) await d1Cleanup(env.DB, table);
  });

  await runStep("history cleanup", () => cleanupExpiredHistory(env));
  await runStep("tombstone purge", () => purgeTombstones(env));
  await runStep("auth cleanup", () => cleanupAuthState(env));
  await runStep("daily usage cleanup", () => cleanupDailyUsage(env));
  await runStep("monthly usage cleanup", () => cleanupMonthlyUsage(env));
  await runStep("billing claim cleanup", () => cleanupBillingClaims(env));
  await runStep("sync state cleanup", () => cleanupSyncState(env));
  await runStep("scheduled deletion purge", () => purgeScheduledDeletions(env));
  await runStep("speech cache purge", () => purgeExpiredSpeechCache(env));
  await runStep("flutterwave reconciliation", () =>
    reconcileFlutterwaveTransactions(env),
  );
}
