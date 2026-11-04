import type { Env, Tier, UsageType } from "@/core/types";
import { getLimits } from "@/core/limits";
import { logger } from "@/core/logger";
import { recordUserEvent } from "@/utils/analytics";
import { describeError, retryTransient } from "@/db/retry";
import {
  aiCreditsForUsage,
  nextUtcMonthStartMs,
  USAGE_METER_META,
  usageSnapshotSchema,
  utcDay,
  utcMonth,
} from "@ekwe/shared";
import type { UsageMeterId, UsageSnapshot } from "@ekwe/shared";

function deltas(
  type: UsageType,
  charCount: number,
  durationMs: number,
): {
  translate: number;
  transcribe: number;
  transcribeMs: number;
  speech: number;
  stream: number;
  streamMs: number;
} {
  return {
    translate: type === "translate" ? 1 : 0,
    transcribe: type === "transcribe" ? 1 : 0,
    transcribeMs: type === "transcribe" ? Math.max(0, durationMs) : 0,
    speech: type === "speech" ? Math.max(0, Math.floor(charCount)) : 0,
    // A stream session is counted once at admission; later calls carry the
    // elapsed duration and only add time/credits.
    stream: type === "stream" && durationMs <= 0 ? 1 : 0,
    streamMs: type === "stream" ? Math.max(0, durationMs) : 0,
  };
}

export function trackBillableSuccess(
  env: Env,
  userId: string,
  type: UsageType,
  ctx: ExecutionContext | undefined,
  charCount = 0,
  durationMs = 0,
): void {
  const p = increment(env, userId, type, charCount, durationMs).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(p);
  } else {
    void p;
  }
}

async function increment(
  env: Env,
  userId: string,
  type: UsageType,
  charCount: number,
  durationMs: number,
): Promise<void> {
  const amount = deltas(type, charCount, durationMs);
  const credits = aiCreditsForUsage(type, { chars: charCount, durationMs });
  const now = Date.now();
  const day = utcDay(now);
  const month = utcMonth(now);

  try {
    await retryTransient(() =>
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO user_daily_usage
             (user_id, day, translate_count, transcribe_count, transcribe_ms,
              speech_chars, stream_count, stream_ms, ai_credits, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, day) DO UPDATE SET
             translate_count  = user_daily_usage.translate_count  + excluded.translate_count,
             transcribe_count = user_daily_usage.transcribe_count + excluded.transcribe_count,
             transcribe_ms    = user_daily_usage.transcribe_ms    + excluded.transcribe_ms,
             speech_chars     = user_daily_usage.speech_chars     + excluded.speech_chars,
             stream_count     = user_daily_usage.stream_count     + excluded.stream_count,
             stream_ms        = user_daily_usage.stream_ms        + excluded.stream_ms,
             ai_credits       = user_daily_usage.ai_credits       + excluded.ai_credits,
             updated_at       = excluded.updated_at`,
        ).bind(
          userId,
          day,
          amount.translate,
          amount.transcribe,
          amount.transcribeMs,
          amount.speech,
          amount.stream,
          amount.streamMs,
          credits,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO user_monthly_usage
             (user_id, month, translate_count, transcribe_count, transcribe_ms,
              speech_chars, stream_count, stream_ms, ai_credits, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, month) DO UPDATE SET
             translate_count  = user_monthly_usage.translate_count  + excluded.translate_count,
             transcribe_count = user_monthly_usage.transcribe_count + excluded.transcribe_count,
             transcribe_ms    = user_monthly_usage.transcribe_ms    + excluded.transcribe_ms,
             speech_chars     = user_monthly_usage.speech_chars     + excluded.speech_chars,
             stream_count     = user_monthly_usage.stream_count     + excluded.stream_count,
             stream_ms        = user_monthly_usage.stream_ms        + excluded.stream_ms,
             ai_credits       = user_monthly_usage.ai_credits       + excluded.ai_credits,
             updated_at       = excluded.updated_at`,
        ).bind(
          userId,
          month,
          amount.translate,
          amount.transcribe,
          amount.transcribeMs,
          amount.speech,
          amount.stream,
          amount.streamMs,
          credits,
          now,
        ),
      ]),
    );
    await recordUserEvent(env, "usage", userId, "ok", type);
  } catch (error) {
    logger.error("[usage] increment failed", {
      error: describeError(error),
      type,
      recorded: false,
    });
    await recordUserEvent(env, "usage", userId, "fail", type);
  }
}

function roundMinutes(ms: number | undefined): number {
  return Math.round(((ms ?? 0) / 60_000) * 10) / 10;
}

function roundCredits(credits: number | undefined): number {
  return Math.round((credits ?? 0) * 10) / 10;
}

/**
 * Monthly feature usage plus the tier's caps and the shared AI credit pool.
 * `total === 0` means the feature is unavailable and the client hides the
 * meter. Every meter has a finite total now; `null` is kept in the wire schema
 * so older clients can still read a snapshot.
 */
export async function fetchUsageSnapshot(
  env: Env,
  userId: string,
  tier: Tier,
): Promise<UsageSnapshot | null> {
  const now = Date.now();
  const day = utcDay(now);
  const month = utcMonth(now);
  const monthResetsAt = nextUtcMonthStartMs(now);

  try {
    const row = await retryTransient(() =>
      env.DB.prepare(
        `SELECT translate_count, transcribe_count, transcribe_ms, speech_chars,
                stream_count, stream_ms, ai_credits
           FROM user_monthly_usage
          WHERE user_id = ? AND month = ?`,
      )
        .bind(userId, month)
        .first<{
          translate_count: number;
          transcribe_count: number;
          transcribe_ms: number;
          speech_chars: number;
          stream_count: number;
          stream_ms: number;
          ai_credits: number;
        }>(),
    );

    const used: Record<UsageMeterId, number> = {
      translate: row?.translate_count ?? 0,
      transcribe: roundMinutes(row?.transcribe_ms),
      speech: row?.speech_chars ?? 0,
      stream: roundMinutes(row?.stream_ms),
      budget: roundCredits(row?.ai_credits),
    };

    const limits = getLimits(tier);
    const totals: Record<UsageMeterId, number | null> = {
      translate: limits.monthlyTranslateLimit,
      transcribe: limits.monthlyTranscribeMinutesLimit,
      speech: limits.monthlySpeechCharsLimit,
      stream: limits.monthlyStreamMinutesLimit,
      budget: limits.monthlyAiCreditsLimit,
    };

    const parsed = usageSnapshotSchema.safeParse({
      day,
      resetsAt: monthResetsAt,
      month,
      monthResetsAt,
      meters: USAGE_METER_META.map(({ id, label, unit }) => {
        const total = totals[id];
        return {
          id,
          label,
          unit,
          used: used[id],
          total,
          remaining: total === null ? null : Math.max(total - used[id], 0),
        };
      }),
    });

    if (!parsed.success) {
      logger.error("[usage] snapshot failed shared schema validation", {
        issues: parsed.error.issues,
      });
      return null;
    }

    return parsed.data;
  } catch (error) {
    logger.error("[usage] snapshot read failed", {
      error: describeError(error),
    });
    return null;
  }
}
