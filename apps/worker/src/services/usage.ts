import { Env, Tier, UsageType } from "@/core/types";
import { getLimits } from "@/core/limits";
import { logger } from "@/core/logger";
import { recordUserEvent } from "@/utils/analytics";
import { preflightCacheKey, nextUtcMidnightMs } from "@/services/preflight";
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
    consumeUsage(env, userId, type, charCount).finally(async () => {
      try {
        // Only this usage type's entry is stale now. Deleting the untyped key
        // would no longer evict anything, and evicting the sibling types would
        // throw away cache entries that are still valid.
        await env.EKWE_KV.delete(preflightCacheKey(userId, type));
      } catch {
        // A stale cache entry self-expires in 2s and never blocks quota
        // enforcement for long; swallowing here keeps the request path clean.
      }
    }),
  );
}

async function consumeUsage(
  env: Env,
  userId: string,
  type: UsageType,
  charCount = 0,
): Promise<void> {
  try {
    const res = await supabasePost(env, "/rest/v1/rpc/consume_usage", {
      p_user_id: userId,
      p_type: type,
      p_chars: charCount,
    });

    if (res && !res.ok) {
      logger.error("[usage] consume_usage RPC failed", { status: res.status });
    }
    await recordUserEvent(
      env,
      "usage",
      userId,
      res ? (res.ok ? "ok" : "fail") : "unconfigured",
      type,
    );
  } catch (err) {
    logger.error("[usage] consume_usage error", {
      error: err instanceof Error ? err.message : String(err),
    });
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
