import {
  WORKER_ERROR_CODES,
  aiCreditsForUsage,
  nextUtcMonthStartMs,
  utcDay,
  utcMonth,
} from "@ekwe/shared";
import type { Env, Tier, UsageType } from "@/core/types";
import { getLimits } from "@/core/limits";
import { logger } from "@/core/logger";
import { recordUserEvent } from "@/utils/analytics";
import { describeError, retryTransient } from "@/db/retry";

export interface PreflightAllow {
  ok: true;
  tier: Tier;
}

export interface PreflightDeny {
  ok: false;
  response: Response;
}

export type PreflightGateResult = PreflightAllow | PreflightDeny;

export function nextUtcMidnightMs(): number {
  const msPerDay = 86_400_000;
  return Math.ceil(Date.now() / msPerDay) * msPerDay;
}

type CooldownOutcome =
  { allowed: true } | { allowed: false; retryAfter: number };

/**
 * Encode/decode a cooldown timestamp stored in KV as a compact string.
 * Format: "<last_request_ms>" — just the unix-ms timestamp.
 */
function encodeCooldown(lastMs: number): string {
  return String(lastMs);
}
function decodeCooldown(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Claim the user's cooldown slot using KV.
 *
 * KV is ~3-5× faster than a D1 write for this hot path and eliminates
 * per-request write contention on the main database. A ±1-request race
 * window is acceptable for cooldown enforcement.
 *
 * Falls back to `allowed: true` when KV is unavailable so a KV outage
 * never blocks users from making requests.
 */
async function consumeCooldown(
  env: Env,
  userId: string,
  cooldownMs: number,
): Promise<CooldownOutcome> {
  const key = `cdwn:${userId}`;
  const now = Date.now();

  try {
    const raw = await env.EKWE_KV.get(key, "text");
    const lastMs = decodeCooldown(raw);

    if (lastMs !== null && now - lastMs < cooldownMs) {
      const retryAfter = Math.max(
        1,
        Math.ceil((lastMs + cooldownMs - now) / 1000),
      );
      return { allowed: false, retryAfter };
    }

    const ttlSeconds = Math.ceil(cooldownMs / 1000) + 10;
    await env.EKWE_KV.put(key, encodeCooldown(now), {
      expirationTtl: ttlSeconds,
    });
    return { allowed: true };
  } catch {
    // KV unavailable — fail open so users aren't blocked.
    logger.warn("[preflight] KV cooldown unavailable, failing open", {
      userId,
    });
    return { allowed: true };
  }
}

/**
 * Claim a sync-push slot using KV. A separate key prefix from the speech
 * cooldown keeps a write-heavy push from racing with the next billable request.
 *
 * Returns null when the push is allowed, or seconds-to-wait when throttled.
 */
export async function claimSyncPush(
  env: Env,
  userId: string,
  cooldownMs: number,
): Promise<number | null> {
  const key = `scdwn:${userId}`;
  const now = Date.now();

  try {
    const raw = await env.EKWE_KV.get(key, "text");
    const lastMs = decodeCooldown(raw);

    if (lastMs !== null && now - lastMs < cooldownMs) {
      return Math.max(1, Math.ceil((lastMs + cooldownMs - now) / 1000));
    }

    const ttlSeconds = Math.ceil(cooldownMs / 1000) + 10;
    await env.EKWE_KV.put(key, encodeCooldown(now), {
      expirationTtl: ttlSeconds,
    });
    return null;
  } catch {
    // KV unavailable — allow the push so users aren't blocked.
    logger.warn("[preflight] KV sync cooldown unavailable, failing open", {
      userId,
    });
    return null;
  }
}

const DAILY_COLUMN = {
  translate: "translate_count",
  transcribe: "transcribe_ms",
  speech: "speech_chars",
  stream: "stream_count",
} as const;

function dailyLimitFor(tier: Tier, type: UsageType): number {
  const limits = getLimits(tier);
  switch (type) {
    case "translate":
      return limits.dailyTranslateLimit;
    case "transcribe":
      return limits.dailyTranscribeMinutesLimit;
    case "speech":
      return limits.dailySpeechCharsLimit;
    case "stream":
      return limits.dailyStreamLimit;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function monthlyLimitFor(tier: Tier, type: UsageType): number {
  const limits = getLimits(tier);
  switch (type) {
    case "translate":
      return limits.monthlyTranslateLimit;
    case "transcribe":
      return limits.monthlyTranscribeMinutesLimit;
    case "speech":
      return limits.monthlySpeechCharsLimit;
    case "stream":
      return limits.monthlyStreamMinutesLimit;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

interface MonthlyUsageRow {
  translate_count: number;
  transcribe_ms: number;
  speech_chars: number;
  stream_ms: number;
  ai_credits: number;
}

async function readDailyUsed(
  env: Env,
  userId: string,
  type: UsageType,
): Promise<number> {
  const row = await retryTransient(() =>
    env.DB.prepare(
      `SELECT ${DAILY_COLUMN[type]} AS used
         FROM user_daily_usage
        WHERE user_id = ? AND day = ?`,
    )
      .bind(userId, utcDay(Date.now()))
      .first<{ used: number }>(),
  );
  const used = row?.used ?? 0;
  return type === "transcribe" ? used / 60_000 : used;
}

export async function readMonthlyUsage(
  env: Env,
  userId: string,
): Promise<MonthlyUsageRow> {
  return (
    (await retryTransient(() =>
      env.DB.prepare(
        `SELECT translate_count, transcribe_ms, speech_chars, stream_ms, ai_credits
           FROM user_monthly_usage
          WHERE user_id = ? AND month = ?`,
      )
        .bind(userId, utcMonth(Date.now()))
        .first<MonthlyUsageRow>(),
    )) ?? {
      translate_count: 0,
      transcribe_ms: 0,
      speech_chars: 0,
      stream_ms: 0,
      ai_credits: 0,
    }
  );
}

function monthlyUsedFor(row: MonthlyUsageRow, type: UsageType): number {
  switch (type) {
    case "translate":
      return row.translate_count;
    case "transcribe":
      return row.transcribe_ms / 60_000;
    case "speech":
      return row.speech_chars;
    case "stream":
      return row.stream_ms / 60_000;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * How much the current request will add to the meter. A missing duration is
 * treated as "unknown" (0), so the middleware lets the request reach the route,
 * where the real duration is known and the gate runs again.
 */
function dailyNeedFor(
  type: UsageType,
  chargeChars: number,
  durationMs: number,
): number {
  switch (type) {
    case "translate":
    case "stream":
      return 1;
    case "transcribe":
      return Math.max(0, durationMs) / 60_000;
    case "speech":
      return Math.max(0, chargeChars);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function monthlyNeedFor(
  type: UsageType,
  chargeChars: number,
  durationMs: number,
): number {
  switch (type) {
    case "translate":
      return 1;
    case "transcribe":
    case "stream":
      return Math.max(0, durationMs) / 60_000;
    case "speech":
      return Math.max(0, chargeChars);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function quotaExceeded(
  usageType: UsageType,
  scope: "daily" | "monthly" | "budget",
  total: number,
  remaining: number,
  unit: string,
): Response {
  const resetAt =
    scope === "daily" ? nextUtcMidnightMs() : nextUtcMonthStartMs(Date.now());
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const message =
    scope === "daily"
      ? "You've reached your daily limit. Try again tomorrow."
      : scope === "monthly"
        ? "You've reached your monthly limit. It resets next month."
        : "Your shared AI budget is used up for this month.";

  return Response.json(
    {
      error: WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED,
      message,
      usage_type: usageType,
      quota_scope: scope,
      quota_unit: unit,
      quota_total: Math.round(total * 10) / 10,
      quota_remaining: Math.round(Math.max(remaining, 0) * 10) / 10,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

function rateLimited(retryAfter: number): Response {
  return Response.json(
    {
      error: WORKER_ERROR_CODES.EKWE_RATE_LIMIT,
      message: `Please wait ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

function unavailable(): Response {
  return Response.json(
    {
      error: WORKER_ERROR_CODES.SERVICE_UNAVAILABLE,
      message: "Service temporarily unavailable. Please try again.",
    },
    { status: 503 },
  );
}

/**
 * Cooldown + daily cap + monthly cap + shared AI budget gate.
 *
 * `skipCooldown` is set for the second and later stages of one HTTP request
 * (a transcript that is then translated), so one request costs one cooldown.
 *
 * The quota check is a point read: usage is charged after the work succeeds,
 * so there is nothing to reserve or refund. A `null` cap means unlimited and
 * skips the read; a `0` cap denies everything (the feature is unavailable).
 * Translation, transcription, speech, and live dictation all spend the same
 * monthly credit budget, which is what makes them exhaust together.
 */
export async function runPreflightGate(
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void } | undefined,
  userId: string,
  tier: Tier,
  usageType: UsageType,
  skipCooldown = false,
  chargeChars = 0,
  durationMs = 0,
): Promise<PreflightGateResult> {
  const defer = (promise: Promise<unknown>) => {
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(promise);
    } else {
      void promise;
    }
  };

  const cooldownSeconds = skipCooldown ? 0 : getLimits(tier).cooldownSeconds;

  if (cooldownSeconds > 0) {
    let outcome: CooldownOutcome;
    try {
      outcome = await consumeCooldown(env, userId, cooldownSeconds * 1000);
    } catch (error) {
      logger.error("[preflight] cooldown write failed, failing closed", {
        error: describeError(error),
        type: usageType,
      });
      return { ok: false, response: unavailable() };
    }

    if (!outcome.allowed) {
      defer(
        recordUserEvent(
          env,
          "preflight",
          userId,
          "deny",
          usageType,
          "RATE_LIMIT",
        ).catch(() => {}),
      );
      return { ok: false, response: rateLimited(outcome.retryAfter) };
    }
  }

  const dailyLimit = dailyLimitFor(tier, usageType);
  const dailyNeed = dailyNeedFor(usageType, chargeChars, durationMs);
  const monthlyLimit = monthlyLimitFor(tier, usageType);
  const monthlyNeed = monthlyNeedFor(usageType, chargeChars, durationMs);
  const budgetLimit = getLimits(tier).monthlyAiCreditsLimit;
  const budgetNeed = aiCreditsForUsage(usageType, {
    chars: chargeChars,
    durationMs,
  });

  let dailyUsed: number;
  let monthly: MonthlyUsageRow;
  try {
    [dailyUsed, monthly] = await Promise.all([
      readDailyUsed(env, userId, usageType),
      readMonthlyUsage(env, userId),
    ]);
  } catch (error) {
    logger.error("[preflight] quota read failed, failing closed", {
      error: describeError(error),
      type: usageType,
    });
    return { ok: false, response: unavailable() };
  }

  if (
    Number.isFinite(dailyLimit) &&
    (dailyNeed > 0
      ? dailyUsed + dailyNeed > dailyLimit
      : dailyUsed >= dailyLimit)
  ) {
    defer(
      recordUserEvent(
        env,
        "preflight",
        userId,
        "deny",
        usageType,
        "QUOTA_EXCEEDED",
      ).catch(() => {}),
    );
    return {
      ok: false,
      response: quotaExceeded(
        usageType,
        "daily",
        dailyLimit,
        dailyLimit - dailyUsed,
        dailyUnitFor(usageType),
      ),
    };
  }

  const monthlyUsed = monthlyUsedFor(monthly, usageType);
  if (
    Number.isFinite(monthlyLimit) &&
    (monthlyNeed > 0
      ? monthlyUsed + monthlyNeed > monthlyLimit
      : monthlyUsed >= monthlyLimit)
  ) {
    if (
      tier === "PREMIUM" &&
      usageType !== "speech" &&
      usageType !== "stream"
    ) {
      defer(
        recordUserEvent(
          env,
          "preflight",
          userId,
          "allow",
          usageType,
          "soft_cap_fallback",
        ).catch(() => {}),
      );
      return { ok: true, tier: "FREE" };
    }

    defer(
      recordUserEvent(
        env,
        "preflight",
        userId,
        "deny",
        usageType,
        "QUOTA_EXCEEDED",
      ).catch(() => {}),
    );
    return {
      ok: false,
      response: quotaExceeded(
        usageType,
        "monthly",
        monthlyLimit,
        monthlyLimit - monthlyUsed,
        monthlyUnitFor(usageType),
      ),
    };
  }

  if (
    Number.isFinite(budgetLimit) &&
    (budgetNeed > 0
      ? monthly.ai_credits + budgetNeed > budgetLimit
      : monthly.ai_credits >= budgetLimit)
  ) {
    defer(
      recordUserEvent(
        env,
        "preflight",
        userId,
        "deny",
        usageType,
        "QUOTA_EXCEEDED",
      ).catch(() => {}),
    );
    return {
      ok: false,
      response: quotaExceeded(
        usageType,
        "budget",
        budgetLimit,
        budgetLimit - monthly.ai_credits,
        "credits",
      ),
    };
  }

  defer(
    recordUserEvent(env, "preflight", userId, "allow", usageType, "ok").catch(
      () => {},
    ),
  );

  return { ok: true, tier };
}

/**
 * Same gate as runPreflightGate but accepts pre-fetched usage rows.
 * Use in multi-stage pipelines (synthesize audio) to avoid re-reading D1
 * on every stage — read once, pass through.
 */
export async function runPreflightGateWithUsage(
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void } | undefined,
  userId: string,
  tier: Tier,
  usageType: UsageType,
  prefetched: { daily: number; monthly: MonthlyUsageRow },
  skipCooldown = false,
  chargeChars = 0,
  durationMs = 0,
): Promise<PreflightGateResult> {
  const defer = (promise: Promise<unknown>) => {
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(promise);
    } else {
      void promise;
    }
  };

  const cooldownSeconds = skipCooldown ? 0 : getLimits(tier).cooldownSeconds;

  if (cooldownSeconds > 0) {
    let outcome: CooldownOutcome;
    try {
      outcome = await consumeCooldown(env, userId, cooldownSeconds * 1000);
    } catch (error) {
      logger.error("[preflight] cooldown write failed, failing closed", {
        error: describeError(error),
        type: usageType,
      });
      return { ok: false, response: unavailable() };
    }
    if (!outcome.allowed) {
      defer(
        recordUserEvent(
          env,
          "preflight",
          userId,
          "deny",
          usageType,
          "RATE_LIMIT",
        ).catch(() => {}),
      );
      return { ok: false, response: rateLimited(outcome.retryAfter) };
    }
  }

  const dailyLimit = dailyLimitFor(tier, usageType);
  const dailyNeed = dailyNeedFor(usageType, chargeChars, durationMs);
  const monthlyLimit = monthlyLimitFor(tier, usageType);
  const monthlyNeed = monthlyNeedFor(usageType, chargeChars, durationMs);
  const budgetLimit = getLimits(tier).monthlyAiCreditsLimit;
  const budgetNeed = aiCreditsForUsage(usageType, {
    chars: chargeChars,
    durationMs,
  });

  const dailyUsed = prefetched.daily;
  const monthly = prefetched.monthly;

  if (
    Number.isFinite(dailyLimit) &&
    (dailyNeed > 0
      ? dailyUsed + dailyNeed > dailyLimit
      : dailyUsed >= dailyLimit)
  ) {
    defer(
      recordUserEvent(
        env,
        "preflight",
        userId,
        "deny",
        usageType,
        "QUOTA_EXCEEDED",
      ).catch(() => {}),
    );
    return {
      ok: false,
      response: quotaExceeded(
        usageType,
        "daily",
        dailyLimit,
        dailyLimit - dailyUsed,
        dailyUnitFor(usageType),
      ),
    };
  }

  const monthlyUsed = monthlyUsedFor(monthly, usageType);
  if (
    Number.isFinite(monthlyLimit) &&
    (monthlyNeed > 0
      ? monthlyUsed + monthlyNeed > monthlyLimit
      : monthlyUsed >= monthlyLimit)
  ) {
    if (
      tier === "PREMIUM" &&
      usageType !== "speech" &&
      usageType !== "stream"
    ) {
      defer(
        recordUserEvent(
          env,
          "preflight",
          userId,
          "allow",
          usageType,
          "soft_cap_fallback",
        ).catch(() => {}),
      );
      return { ok: true, tier: "FREE" };
    }

    defer(
      recordUserEvent(
        env,
        "preflight",
        userId,
        "deny",
        usageType,
        "QUOTA_EXCEEDED",
      ).catch(() => {}),
    );
    return {
      ok: false,
      response: quotaExceeded(
        usageType,
        "monthly",
        monthlyLimit,
        monthlyLimit - monthlyUsed,
        monthlyUnitFor(usageType),
      ),
    };
  }

  if (
    Number.isFinite(budgetLimit) &&
    (budgetNeed > 0
      ? monthly.ai_credits + budgetNeed > budgetLimit
      : monthly.ai_credits >= budgetLimit)
  ) {
    defer(
      recordUserEvent(
        env,
        "preflight",
        userId,
        "deny",
        usageType,
        "QUOTA_EXCEEDED",
      ).catch(() => {}),
    );
    return {
      ok: false,
      response: quotaExceeded(
        usageType,
        "budget",
        budgetLimit,
        budgetLimit - monthly.ai_credits,
        "credits",
      ),
    };
  }

  defer(
    recordUserEvent(env, "preflight", userId, "allow", usageType, "ok").catch(
      () => {},
    ),
  );
  return { ok: true, tier };
}

export type { MonthlyUsageRow };

function dailyUnitFor(type: UsageType): string {
  return type === "transcribe"
    ? "min"
    : type === "speech"
      ? "chars"
      : "requests";
}

function monthlyUnitFor(type: UsageType): string {
  return type === "transcribe" || type === "stream"
    ? "min"
    : type === "speech"
      ? "chars"
      : "requests";
}
