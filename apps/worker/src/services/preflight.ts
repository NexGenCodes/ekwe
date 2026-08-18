import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env, Tier, UsageType } from "../core/types";
import { getLimits } from "../core/limits";
import { logger } from "../core/logger";
import { supabasePost, supabaseServiceHeaders } from "./supabase";

type PreflightReason =
  | "RATE_LIMIT"
  | "QUOTA_EXCEEDED"
  | "SESSION_INACTIVE"
  | "PREFLIGHT_CONFIG_ERROR"
  | "PREFLIGHT_UNAVAILABLE";

interface PreflightResponse {
  allowed: boolean;
  tier_active: Tier;
  reason?: PreflightReason;
  cooldown_remaining?: number;
  quota_total?: number;
  quota_remaining?: number;
  /**
   * True when a PREMIUM user is past the abuse throttle threshold for this
   * usage type. They are never blocked — the caller serves the request with
   * FREE-tier limits until UTC midnight.
   */
  throttled?: boolean;
}

interface PreflightGateSuccess {
  ok: true;
  preflight: PreflightResponse;
}

interface PreflightGateFailure {
  ok: false;
  response: Response;
}

type PreflightGateResult = PreflightGateSuccess | PreflightGateFailure;

/**
 * KV key backing the short-lived preflight decision cache. Shared with
 * `utils/usage.ts`, which deletes it after a billable success so the next
 * request re-runs the RPC and sees the fresh remaining count.
 */
export function preflightCacheKey(userId: string): string {
  return `preflight:${userId}`;
}

/**
 * Atomic cooldown + daily quota gate with a short-lived KV cache.
 * Each request type draws down a separate daily pool, so the cached gate
 * carries the type it was minted for and a mismatched type misses the cache
 * and re-runs the RPC.
 *
 * The 2s cache lets a client's repeated rapid requests reuse the same gate
 * instead of hammering the RPC. On a cache miss the result is stored
 * fire-and-forget via `ctx.waitUntil`, never blocking the response.
 */
export async function runPreflightGate(
  env: Env,
  ctx: ExecutionContext,
  userId: string,
  tier: Tier,
  usageType: UsageType,
  sessionId: string | null,
): Promise<PreflightGateResult> {
  type CachedPreflight = PreflightResponse & { usage_type?: UsageType };

  const cacheKey = preflightCacheKey(userId);
  const cached = await env.EKWE_KV.get(cacheKey);

  let preflight: PreflightResponse;
  let wasCached = false;
  if (cached) {
    wasCached = true;
    try {
      const parsed = JSON.parse(cached) as CachedPreflight;
      preflight =
        parsed.usage_type === usageType
          ? parsed
          : await checkPreflight(env, userId, tier, usageType, sessionId);
    } catch {
      logger.debug("[preflight] Cache parse failed, fetching fresh preflight");
      preflight = await checkPreflight(env, userId, tier, usageType, sessionId);
    }
  } else {
    preflight = await checkPreflight(env, userId, tier, usageType, sessionId);
  }

  if (!preflight.allowed) {
    if (preflight.reason === "SESSION_INACTIVE") {
      return {
        ok: false,
        response: Response.json(
          {
            error: WORKER_ERROR_CODES.UNAUTHORIZED,
            message: "Session expired. Please sign in again.",
          },
          { status: 401 },
        ),
      };
    }
    if (preflight.reason === "QUOTA_EXCEEDED") {
      return {
        ok: false,
        response: Response.json(
          {
            error: WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED,
            message: "You've reached your daily limit. Try again tomorrow.",
            quota_total: preflight.quota_total,
            quota_remaining: 0,
          },
          {
            status: 429,
            headers: { "Retry-After": String(secondsUntilUtcMidnight()) },
          },
        ),
      };
    }
    if (
      preflight.reason === "PREFLIGHT_CONFIG_ERROR" ||
      preflight.reason === "PREFLIGHT_UNAVAILABLE"
    ) {
      return {
        ok: false,
        response: Response.json(
          {
            error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
            message: "Service temporarily unavailable. Please try again later.",
          },
          { status: 500 },
        ),
      };
    }
    const retryAfter = Math.ceil(preflight.cooldown_remaining || 0);
    return {
      ok: false,
      response: Response.json(
        {
          error: WORKER_ERROR_CODES.EKWE_RATE_LIMIT,
          message: `Please wait ${retryAfter} seconds.`,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      ),
    };
  }

  if (!wasCached) {
    ctx.waitUntil(
      env.EKWE_KV.put(
        cacheKey,
        JSON.stringify({ ...preflight, usage_type: usageType }),
        { expirationTtl: 2 },
      ).catch(() => {}),
    );
  }

  return { ok: true, preflight };
}

/**
 * Milliseconds until the next UTC midnight — the daily quota reset boundary.
 */
export function nextUtcMidnightMs(): number {
  const now = Date.now();
  const msPerDay = 86_400_000;
  return Math.ceil(now / msPerDay) * msPerDay;
}

/**
 * Seconds until the next UTC midnight. Used for the Retry-After header on
 * 429 quota responses.
 */
function secondsUntilUtcMidnight(): number {
  return Math.max(1, Math.ceil((nextUtcMidnightMs() - Date.now()) / 1000));
}

/**
 * Whether the JWT's session still exists in auth.sessions. Supabase access
 * tokens stay valid until `exp` after the user is deleted, so the local
 * signature check in auth.ts cannot see a revocation. Returns `true` when the
 * session exists, `false` only on a definitive "no such session", and `null`
 * when the RPC is unreachable or the token carried no session_id claim (the
 * caller treats null as "skip the check" — fail open).
 */
async function isSessionActive(
  env: Env,
  sessionId: string | null,
): Promise<boolean | null> {
  if (!sessionId) return null;
  try {
    const res = await supabasePost(env, "/rest/v1/rpc/check_session_active", {
      p_session_id: sessionId,
    });
    if (res?.ok) return Boolean(await res.json<boolean>());
  } catch (err) {
    logger.warn("[preflight] session-active check failed, allowing", {
      error: err,
    });
  }
  return null;
}

/**
 * Atomic cooldown + daily quota gate, executed server-side in one RPC call.
 * The Worker owns the numeric limits (passed in), so plan changes never
 * require a migration. The RPC derives the AUTHORITATIVE tier from
 * `user_subscriptions` and applies that tier's limits — a user whose webhook
 * landed (or lapsed) before their JWT refreshed is gated correctly, not by
 * the stale JWT tier. Fails closed on any config/network problem.
 */
export async function checkPreflight(
  env: Env,
  userId: string,
  requestedTier: Tier,
  type: UsageType,
  sessionId: string | null,
): Promise<PreflightResponse> {
  const isTranscribe = type === "transcribe";
  // Pass BOTH tiers' limits: the RPC picks the effective ones from the
  // authoritative tier. The free tier never throttles (threshold 0), and a
  // throttled PREMIUM request is served with the free cooldown.
  const freeLimits = getLimits("FREE");
  const premiumLimits = getLimits("PREMIUM");
  const freeCooldownSeconds = freeLimits.cooldownSeconds;
  const freeDailyLimit = isTranscribe
    ? freeLimits.dailyTranscribeLimit
    : freeLimits.dailyTranslateLimit;
  const premiumCooldownSeconds = premiumLimits.cooldownSeconds;
  const premiumDailyLimit = isTranscribe
    ? premiumLimits.dailyTranscribeLimit
    : premiumLimits.dailyTranslateLimit;
  const premiumThrottleThreshold = isTranscribe
    ? premiumLimits.throttleTranscribeThreshold
    : premiumLimits.throttleTranslateThreshold;

  // Reject a deleted/banned user before touching the quota RPC (a revoked
  // session must not burn cooldown or quota for a user that no longer exists).
  const sessionActive = await isSessionActive(env, sessionId);
  if (sessionActive === false) {
    return {
      allowed: false,
      tier_active: requestedTier,
      reason: "SESSION_INACTIVE",
    };
  }

  try {
    if (!supabaseServiceHeaders(env)) {
      return {
        allowed: false,
        tier_active: requestedTier,
        reason: "PREFLIGHT_CONFIG_ERROR",
      };
    }

    const res = await supabasePost(env, "/rest/v1/rpc/check_preflight", {
      p_user_id: userId,
      p_type: type,
      p_free_cooldown_seconds: freeCooldownSeconds,
      p_free_daily_limit: freeDailyLimit,
      p_premium_cooldown_seconds: premiumCooldownSeconds,
      p_premium_daily_limit: premiumDailyLimit,
      p_premium_throttle_threshold: premiumThrottleThreshold,
      p_throttle_cooldown_seconds: freeCooldownSeconds,
    });

    if (res?.ok) {
      return await res.json<PreflightResponse>();
    }
    logger.error("[preflight] RPC non-OK or unconfigured, failing closed", {
      status: res?.status,
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
