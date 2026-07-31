import { Env, Tier } from "../types";
import { getLimits } from "../config";
import { logger } from "../logger";

export interface PreflightResponse {
  allowed: boolean;
  tier_active: Tier;
  reason?: string;
  cooldown_remaining?: number;
}

export async function checkPreflight(
  env: Env,
  userId: string,
  requestedTier: Tier,
): Promise<PreflightResponse> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      allowed: false,
      tier_active: requestedTier,
      reason: "PREFLIGHT_CONFIG_ERROR",
    };
  }

  const cooldownSeconds = getLimits(requestedTier).cooldownSeconds;

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
      }),
    });

    if (res.ok) {
      return (await res.json()) as PreflightResponse;
    }
  } catch (err) {
    logger.error("[preflight] check failed, failing closed", { error: err });
  }
  return {
    allowed: false,
    tier_active: requestedTier,
    reason: "PREFLIGHT_UNAVAILABLE",
  };
}
