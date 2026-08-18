import { Env, Tier, UsageType } from "../core/types";
import { getLimits } from "../core/limits";
import { logger } from "../core/logger";
import { preflightCacheKey, nextUtcMidnightMs } from "./preflight";
import { supabasePost } from "./supabase";
import { usageSnapshotSchema } from "@ekwe/shared";
import type { UsageSnapshot } from "@ekwe/shared";

/**
 * Marks a request as having drawn down quota (billable provider success).
 *
 * Deliberately fire-and-forget:
 *   * Runs via `context.waitUntil` so response latency is unchanged.
 *   * Invalidation of the preflight KV cache keeps the 2s gate from serving a
 *     stale "allowed" decision right after a consume — the next request re-runs
 *     the RPC and sees the fresh remaining count.
 *   * Both steps are best-effort and never throw into the request path.
 */
export function trackBillableSuccess(
  env: Env,
  userId: string,
  type: UsageType,
  ctx: ExecutionContext | undefined,
): void {
  if (!ctx) return;
  ctx.waitUntil(
    consumeUsage(env, userId, type).finally(async () => {
      try {
        await env.EKWE_KV.delete(preflightCacheKey(userId));
      } catch {
        // A stale cache entry self-expires in 2s and never blocks quota
        // enforcement for long; swallowing here keeps the request path clean.
      }
    }),
  );
}

/**
 * Atomic +1 against today's counter for the given request type. On failure we
 * log and move on (fail-open): quota is a fairness/abuse backstop, not a
 * billing system, and the per-request gate still caps concurrency.
 */
async function consumeUsage(
  env: Env,
  userId: string,
  type: UsageType,
): Promise<void> {
  try {
    const res = await supabasePost(env, "/rest/v1/rpc/consume_usage", {
      p_user_id: userId,
      p_type: type,
    });

    if (res && !res.ok) {
      logger.error("[usage] consume_usage RPC failed", { status: res.status });
    }
  } catch (err) {
    logger.error("[usage] consume_usage error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Snapshot read (GET /usage) ────────────────────────────────────

/**
 * Full daily-usage snapshot for the mobile quota UI. Limits come from
 * `getLimits(tier)` (the plans SSOT), raw used counts come from the
 * read-only `get_daily_usage` RPC, and `resetsAt` is computed here.
 * Returns null (fails closed) if the RPC is unreachable so callers can
 * degrade to hiding the meter rather than showing garbage.
 */
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
    } = await res.json();

    const limits = getLimits(tier);

    const snapshot = {
      day: data.day,
      resetsAt: nextUtcMidnightMs(),
      translate: {
        used: data.translate,
        total: limits.dailyTranslateLimit,
        remaining: Math.max(limits.dailyTranslateLimit - data.translate, 0),
      },
      transcribe: {
        used: data.transcribe,
        total: limits.dailyTranscribeLimit,
        remaining: Math.max(limits.dailyTranscribeLimit - data.transcribe, 0),
      },
    };

    // The shared schema is the contract the mobile app validates against;
    // fail closed here if we would ever emit a malformed snapshot.
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
