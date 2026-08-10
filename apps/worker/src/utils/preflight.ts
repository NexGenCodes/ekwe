import { Env, Tier, UsageType } from "../types";
import { getLimits } from "../config";
import { logger } from "../logger";

export type PreflightReason =
  | "RATE_LIMIT"
  | "QUOTA_EXCEEDED"
  | "PREFLIGHT_CONFIG_ERROR"
  | "PREFLIGHT_UNAVAILABLE";

export interface PreflightResponse {
  allowed: boolean;
  tier_active: Tier;
  reason?: PreflightReason;
  cooldown_remaining?: number;
  quota_total?: number;
  quota_remaining?: number;
}

/**
 * Atomic cooldown + daily quota gate, executed server-side in one RPC call.
 * The Worker owns the numeric limits (passed in), so plan changes never
 * require a migration. Fails closed on any config/network problem.
 */
export async function checkPreflight(
  env: Env,
  userId: string,
  requestedTier: Tier,
  type: UsageType,
): Promise<PreflightResponse> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      allowed: false,
      tier_active: requestedTier,
      reason: "PREFLIGHT_CONFIG_ERROR",
    };
  }

  const limits = getLimits(requestedTier);
  const cooldownSeconds = limits.cooldownSeconds;
  const dailyLimit =
    type === "transcribe"
      ? limits.dailyTranscribeLimit
      : limits.dailyTranslateLimit;

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_preflight`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_tier: requestedTier,
        p_cooldown_seconds: cooldownSeconds,
        p_type: type,
        p_daily_limit: dailyLimit,
      }),
    });

    if (res.ok) {
      return await res.json<PreflightResponse>();
    }
    logger.error("[preflight] RPC non-OK, failing closed", {
      status: res.status,
    });
  } catch (err) {
    logger.error("[preflight] check failed, failing closed", { error: err });
  }
  return {
    allowed: false,
    tier_active: requestedTier,
    reason: "PREFLIGHT_UNAVAILABLE",
  };
}
