import { Env, UsageType } from "../types";
import { logger } from "../logger";

const PREFLIGHT_CACHE_KEY = (userId: string): string => `preflight:${userId}`;

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
        await env.EKWE_KV.delete(PREFLIGHT_CACHE_KEY(userId));
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
export async function consumeUsage(
  env: Env,
  userId: string,
  type: UsageType,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/consume_usage`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user_id: userId, p_type: type }),
    });

    if (!res.ok) {
      logger.error("[usage] consume_usage RPC failed", { status: res.status });
    }
  } catch (err) {
    logger.error("[usage] consume_usage error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
