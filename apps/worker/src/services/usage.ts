import { Env, Tier, UsageType } from "@/core/types";
import { getLimits } from "@/core/limits";
import { logger } from "@/core/logger";
import { recordUserEvent } from "@/utils/analytics";
import { nextUtcMidnightMs } from "@/services/preflight";
import { getDb } from "@/db";
import { describeError, retryOnConnectionLoss } from "@/db/retry";
import { userDailyUsage } from "@ekwe/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { USAGE_METER_META, usageSnapshotSchema } from "@ekwe/shared";
import type { UsageMeterId, UsageSnapshot, PlanLimits } from "@ekwe/shared";

export function trackBillableSuccess(
  env: Env,
  userId: string,
  type: UsageType,
  ctx: ExecutionContext | undefined,
  charCount = 0,
): void {
  if (!ctx) return;
  ctx.waitUntil(
    consumeUsage(env, userId, type, charCount)
      // A rejection here reaches waitUntil and kills the isolate.
      .catch(() => {}),
  );
}

export function releaseUsage(
  env: Env,
  userId: string,
  type: UsageType,
  ctx: ExecutionContext | undefined,
  charCount = 0,
): void {
  if (!ctx) return;
  ctx.waitUntil(
    refundUsage(env, userId, type, charCount)
      // A rejection here reaches waitUntil and kills the isolate.
      .catch(() => {}),
  );
}

async function refundUsage(
  env: Env,
  userId: string,
  type: UsageType,
  charCount = 0,
): Promise<void> {
  try {
    const db = getDb(env);
    await db.execute(
      sql`SELECT refund_usage(${userId}, ${type}, ${charCount})`,
    );
    await recordUserEvent(env, "usage", userId, "ok", type);
  } catch (err) {
    logger.error("[usage] refund_usage error", {
      error: describeError(err),
      type,
    });
    await recordUserEvent(env, "usage", userId, "fail", type);
  }
}

/**
 * Charge a billable request.
 *
 * `consume_usage` is a blind increment, not an idempotent set, so only 429 is
 * retried — a rate-limited request was never applied. Retrying a timeout or 5xx
 * would risk double-charging. Other failures are logged with `charged: false`
 * and dropped; those logs are the only signal the charge was missed.
 */
async function consumeUsage(
  env: Env,
  userId: string,
  type: UsageType,
  charCount = 0,
): Promise<void> {
  try {
    const db = getDb(env);
    // Not wrapped in retryOnConnectionLoss: this is a +1 counter, so a replay
    // after a lost response would charge twice. Under-charging is cheaper.
    await db.execute(
      sql`SELECT consume_usage(${userId}, ${type}, ${charCount})`,
    );

    await recordUserEvent(env, "usage", userId, "ok", type);
  } catch (err) {
    logger.error("[usage] consume_usage error", {
      error: describeError(err),
      type,
      charged: false,
    });
    await recordUserEvent(env, "usage", userId, "fail", type);
  }
}

export async function fetchUsageSnapshot(
  env: Env,
  userId: string,
  tier: Tier,
): Promise<UsageSnapshot | null> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const [row] = await retryOnConnectionLoss(
      (client) =>
        client
          .select()
          .from(userDailyUsage)
          .where(
            and(eq(userDailyUsage.userId, userId), eq(userDailyUsage.day, day)),
          ),
      env,
    );

    const data = {
      day,
      translate: row?.translateCount ?? 0,
      transcribe: row?.transcribeCount ?? 0,
      speech: row?.speechChars ?? 0,
    };

    const limits = getLimits(tier);

    const meterLimitField: Record<UsageMeterId, keyof PlanLimits> = {
      translate: "dailyTranslateLimit",
      transcribe: "dailyTranscribeLimit",
      speech: "dailySpeechCharsLimit",
    };

    const meters = USAGE_METER_META.map(({ id, label, unit }) => {
      const total = limits[meterLimitField[id]] as number;
      const used = data[id] ?? 0;
      return {
        id,
        label,
        unit,
        used,
        total,
        remaining: Math.max(total - used, 0),
      };
    });

    const snapshot = {
      day: data.day,
      resetsAt: nextUtcMidnightMs(),
      meters,
    };

    const parsed = usageSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      logger.error("[usage] snapshot failed shared schema validation", {
        issues: parsed.error.issues,
      });
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.error("[usage] get_daily_usage error", {
      error: describeError(err),
    });
    return null;
  }
}
