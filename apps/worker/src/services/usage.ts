import { Env, Tier, UsageType } from "@/core/types";
import { getLimits } from "@/core/limits";
import { logger } from "@/core/logger";
import { recordUserEvent } from "@/utils/analytics";
import { nextUtcMidnightMs } from "@/services/preflight";
import { supabasePost } from "@/services/supabase";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await supabasePost(env, "/rest/v1/rpc/consume_usage", {
        p_user_id: userId,
        p_type: type,
        p_chars: charCount,
      });

      if (res?.ok) {
        await recordUserEvent(env, "usage", userId, "ok", type);
        return;
      }

      if (res?.status === 429 && attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }

      logger.error("[usage] consume_usage RPC failed", {
        status: res?.status,
        type,
        attempt,
        charged: false,
      });
      await recordUserEvent(
        env,
        "usage",
        userId,
        res ? "fail" : "unconfigured",
        type,
      );
      return;
    } catch (err) {
      logger.error("[usage] consume_usage error", {
        error: err instanceof Error ? err.message : String(err),
        type,
        attempt,
        charged: false,
      });
      return;
    }
  }
}

export async function fetchUsageSnapshot(
  env: Env,
  userId: string,
  tier: Tier,
): Promise<UsageSnapshot | null> {
  try {
    const res = await supabasePost(env, "/rest/v1/rpc/get_daily_usage", {
      p_user_id: userId,
    });
    if (!res) return null;
    if (!res.ok) {
      logger.error("[usage] get_daily_usage RPC failed", {
        status: res.status,
      });
      return null;
    }

    const data: {
      day: string;
      translate: number;
      transcribe: number;
      speech: number;
    } = await res.json();

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
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
