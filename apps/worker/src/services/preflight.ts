import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env, Tier, UsageType } from "@/core/types";
import { getLimits } from "@/core/limits";
import { logger } from "@/core/logger";
import { recordUserEvent } from "@/utils/analytics";
import { supabasePost, supabaseServiceHeaders } from "@/services/supabase";

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

export function preflightCacheKey(userId: string): string {
  return `preflight:${userId}`;
}

export async function runPreflightGate(
  env: Env,
  ctx: ExecutionContext,
  userId: string,
  tier: Tier,
  usageType: UsageType,
  sessionId: string | null,
  chargeChars = 0,
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
          : await checkPreflight(
              env,
              userId,
              tier,
              usageType,
              sessionId,
              chargeChars,
            );
    } catch {
      logger.debug("[preflight] Cache parse failed, fetching fresh preflight");
      preflight = await checkPreflight(
        env,
        userId,
        tier,
        usageType,
        sessionId,
        chargeChars,
      );
    }
  } else {
    preflight = await checkPreflight(
      env,
      userId,
      tier,
      usageType,
      sessionId,
      chargeChars,
    );
  }

  if (!preflight.allowed) {
    let result: PreflightGateResult;
    if (preflight.reason === "SESSION_INACTIVE") {
      result = {
        ok: false,
        response: Response.json(
          {
            error: WORKER_ERROR_CODES.UNAUTHORIZED,
            message: "Session expired. Please sign in again.",
          },
          { status: 401 },
        ),
      };
    } else if (preflight.reason === "QUOTA_EXCEEDED") {
      result = {
        ok: false,
        response: Response.json(
          {
            error: WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED,
            message: "You've reached your daily limit. Try again tomorrow.",
            usage_type: usageType,
            quota_total: preflight.quota_total,
            quota_remaining: 0,
          },
          {
            status: 429,
            headers: { "Retry-After": String(secondsUntilUtcMidnight()) },
          },
        ),
      };
    } else if (
      preflight.reason === "PREFLIGHT_CONFIG_ERROR" ||
      preflight.reason === "PREFLIGHT_UNAVAILABLE"
    ) {
      result = {
        ok: false,
        response: Response.json(
          {
            error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
            message: "Service temporarily unavailable. Please try again later.",
          },
          { status: 500 },
        ),
      };
    } else {
      const retryAfter = Math.ceil(preflight.cooldown_remaining || 0);
      result = {
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
    await recordUserEvent(
      env,
      "preflight",
      userId,
      "deny",
      usageType,
      preflight.reason ?? "unknown",
    );
    return result;
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

  await recordUserEvent(env, "preflight", userId, "allow", usageType, "ok");

  return { ok: true, preflight };
}

export function nextUtcMidnightMs(): number {
  const now = Date.now();
  const msPerDay = 86_400_000;
  return Math.ceil(now / msPerDay) * msPerDay;
}

function secondsUntilUtcMidnight(): number {
  return Math.max(1, Math.ceil((nextUtcMidnightMs() - Date.now()) / 1000));
}

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

export async function checkPreflight(
  env: Env,
  userId: string,
  requestedTier: Tier,
  type: UsageType,
  sessionId: string | null,
  chargeChars = 0,
): Promise<PreflightResponse> {
  const isTranscribe = type === "transcribe";
  const isSpeech = type === "speech";
  const isStream = type === "stream";
  const freeLimits = getLimits("FREE");
  const premiumLimits = getLimits("PREMIUM");
  const freeCooldownSeconds = freeLimits.cooldownSeconds;
  const freeDailyLimit = isSpeech
    ? freeLimits.dailySpeechCharsLimit
    : isStream
      ? freeLimits.dailyStreamLimit
      : isTranscribe
        ? freeLimits.dailyTranscribeLimit
        : freeLimits.dailyTranslateLimit;
  const premiumCooldownSeconds = premiumLimits.cooldownSeconds;
  const premiumDailyLimit = isSpeech
    ? premiumLimits.dailySpeechCharsLimit
    : isStream
      ? premiumLimits.dailyStreamLimit
      : isTranscribe
        ? premiumLimits.dailyTranscribeLimit
        : premiumLimits.dailyTranslateLimit;
  const premiumThrottleThreshold =
    isSpeech || isStream
      ? 0
      : isTranscribe
        ? premiumLimits.throttleTranscribeThreshold
        : premiumLimits.throttleTranslateThreshold;

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
      p_premium_speech_chars_limit: premiumLimits.dailySpeechCharsLimit,
      p_charge_chars: chargeChars,
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
