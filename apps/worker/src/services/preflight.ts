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
 * Claim the user's cooldown slot.
 *
 * One statement, so two concurrent requests cannot both win: the UPDATE half
 * only runs when the stored timestamp is already older than the cutoff, and
 * D1 serialises writers. An empty RETURNING means the row exists and is still
 * inside the window; the timestamp is then read to say how long is left.
 */
async function consumeCooldown(
  env: Env,
  userId: string,
  cooldownMs: number,
): Promise<CooldownOutcome> {
  const now = Date.now();
  const cutoff = now - cooldownMs;

  const claim = await retryTransient(() =>
    env.DB.prepare(
      `INSERT INTO user_cooldowns (user_id, last_request_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         last_request_at = excluded.last_request_at,
         updated_at = excluded.updated_at
       WHERE user_cooldowns.last_request_at <= ?
       RETURNING last_request_at`,
    )
      .bind(userId, now, now, cutoff)
      .all<{ last_request_at: number }>(),
  );

  if (claim.results.length > 0) return { allowed: true };

  const row = await env.DB.prepare(
    `SELECT last_request_at FROM user_cooldowns WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ last_request_at: number }>();

  const last = row?.last_request_at ?? cutoff;
  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((last + cooldownMs - now) / 1000)),
  };
}

/**
 * Claim a sync-push slot. A separate table from `user_cooldowns` keeps a
 * write-heavy push from delaying the next billable request.
 */
export async function claimSyncPush(
  env: Env,
  userId: string,
  cooldownMs: number,
): Promise<number | null> {
  const now = Date.now();
  const cutoff = now - cooldownMs;

  const claim = await retryTransient(() =>
    env.DB.prepare(
      `INSERT INTO sync_cooldowns (user_id, last_push_at)
       VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         last_push_at = excluded.last_push_at
       WHERE sync_cooldowns.last_push_at <= ?
       RETURNING last_push_at`,
    )
      .bind(userId, now, cutoff)
      .all<{ last_push_at: number }>(),
  );

  if (claim.results.length > 0) return null;

  const row = await env.DB.prepare(
    "SELECT last_push_at FROM sync_cooldowns WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ last_push_at: number }>();

  const last = row?.last_push_at ?? cutoff;
  return Math.max(1, Math.ceil((last + cooldownMs - now) / 1000));
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

async function readMonthlyUsage(
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
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
  userId: string,
  tier: Tier,
  usageType: UsageType,
  skipCooldown = false,
  chargeChars = 0,
  durationMs = 0,
): Promise<PreflightGateResult> {
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
      ctx.waitUntil(
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
    dailyNeed > 0 ? dailyUsed + dailyNeed > dailyLimit : dailyUsed >= dailyLimit
  ) {
    ctx.waitUntil(
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
    monthlyNeed > 0
      ? monthlyUsed + monthlyNeed > monthlyLimit
      : monthlyUsed >= monthlyLimit
  ) {
    ctx.waitUntil(
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
    budgetNeed > 0
      ? monthly.ai_credits + budgetNeed > budgetLimit
      : monthly.ai_credits >= budgetLimit
  ) {
    ctx.waitUntil(
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

  ctx.waitUntil(
    recordUserEvent(env, "preflight", userId, "allow", usageType, "ok").catch(
      () => {},
    ),
  );

  return { ok: true, tier };
}

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
