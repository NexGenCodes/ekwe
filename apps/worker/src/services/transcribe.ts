import { transcribeResponseSchema } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { getProviderModule, getProviderNamesFor } from "@/providers";
import { PROVIDER_TIMEOUT } from "@/core/providers";
import { logSkips, planSttRoute } from "@/core/route-eligibility";
import type { AudioCodec } from "@ekwe/shared/providerLimits";
import {
  FALLBACK_ATTEMPT_TIMEOUT_MS,
  TRANSCRIBE_CACHE_TTL_SECONDS,
} from "@/core/budgets";
import { sanitizeProviderOutput } from "@/core/sanitize";
import { getLimits } from "@/core/limits";
import { d1Get, d1Put } from "@/services/d1-cache";
import { runProviderFailover } from "@/utils/retry";
import {
  isProviderDegraded,
  reportProviderNeutral,
  reportProviderOutcome,
} from "@/services/health";
import {
  detectTextLanguage,
  validateTranscriptLanguage,
} from "@/services/auto-detect";
import { Env, Tier, TranscribeResult, SttFn } from "@/core/types";

export async function readTranscribeCache(
  env: Env,
  cacheKey: string,
): Promise<TranscribeResult | null> {
  if (!env.EKWE_D1) return null;
  try {
    const cached = await d1Get(env.EKWE_D1, "cache_transcription", cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as TranscribeResult;
      const shapeCheck = transcribeResponseSchema.safeParse(parsed);
      if (shapeCheck.success) return parsed;
      logger.warn(
        `[transcribe] D1 cache entry failed validation (ignoring): ${cacheKey}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] D1 cache lookup error (continuing): ${msg}`);
  }
  return null;
}

export async function writeTranscribeCache(
  env: Env,
  cacheKey: string,
  userId: string,
  tier: string,
  result: TranscribeResult,
): Promise<void> {
  if (!env.EKWE_D1) return;
  try {
    await d1Put(
      env.EKWE_D1,
      "cache_transcription",
      cacheKey,
      userId,
      tier,
      JSON.stringify(result),
      TRANSCRIBE_CACHE_TTL_SECONDS,
    );
  } catch (err) {
    logger.error(`[transcribe] D1 cache write error`, {
      error: String(err),
    });
  }
}

export interface TranscribeCacheKeyParts {
  userId: string;
  tier: string;
  audioHash: string;
  lang: string | null;
}

export function buildTranscribeCacheKey({
  userId,
  tier,
  audioHash,
  lang,
}: TranscribeCacheKeyParts): string {
  return `transcribe:${userId}:${tier}:${audioHash}:${lang || "auto"}`;
}

export function stripTranscriptLanguage(
  result: TranscribeResult,
  tier: Tier,
): TranscribeResult {
  const limits = getLimits(tier);
  const text = sanitizeProviderOutput(result.text);
  const r: TranscribeResult = { ...result, text };
  if (!limits.autoDetectAllowed && "language" in r) {
    delete r.language;
  }
  return r;
}

interface PipelineEntry {
  name: string;
  timeoutMs: number;
  fn: SttFn;
}

function buildPipeline(
  names: readonly string[],
  tier: "free" | "premium",
): PipelineEntry[] {
  return names.map((name) => ({
    name,
    timeoutMs:
      PROVIDER_TIMEOUT[name as keyof typeof PROVIDER_TIMEOUT]?.[tier] ??
      FALLBACK_ATTEMPT_TIMEOUT_MS.transcribe,
    fn: getProviderModule(name)?.stt ?? (() => Promise.resolve(null)),
  }));
}

const FREE_PIPELINE = buildPipeline(getProviderNamesFor("stt", "FREE"), "free");
const PREMIUM_PIPELINE = buildPipeline(
  getProviderNamesFor("stt", "PREMIUM"),
  "premium",
);

export interface TranscribeOptions {
  audioBlob: Blob;
  effectiveLang: string;
  isAuto: boolean;
  codec: AudioCodec;
  tier: Tier;
  env: Env;
  signal: AbortSignal;
  budgetMs: number;
  durationMs: number;
}

export async function runTranscribe(
  options: TranscribeOptions,
): Promise<TranscribeResult | null> {
  const {
    audioBlob,
    effectiveLang,
    isAuto,
    codec,
    tier,
    env,
    signal,
    budgetMs,
    durationMs,
  } = options;

  const pipeline = tier === "FREE" ? FREE_PIPELINE : PREMIUM_PIPELINE;

  const byName = new Map(pipeline.map((p) => [p.name, p]));
  const entry = (name: string): PipelineEntry => {
    const e = byName.get(name);
    if (!e) throw new Error(`[transcribe] Unknown provider: ${name}`);
    return e;
  };

  const plan = planSttRoute(
    pipeline.map((p) => p.name),
    {
      lang: effectiveLang,
      isAuto,
      codec,
      bytes: audioBlob.size,
      durationMs,
    },
  );
  const planByProvider = new Map(plan.map((a) => [a.provider, a]));
  logSkips("transcribe", plan);

  const result = await runProviderFailover<TranscribeResult>({
    providers: pipeline.map((p) => p.name),
    signal,
    totalMs: budgetMs,
    route: "transcribe",
    env,
    tier,
    attemptTimeoutMs: (name, remainingMs) =>
      Math.min(entry(name).timeoutMs, remainingMs),
    shouldSkip: async (name) => {
      const planned = planByProvider.get(name);
      if (planned && !planned.eligible) return planned.reason ?? null;
      // The only dynamic skip: health state, which needs the KV store.
      if (await isProviderDegraded(env, name)) return "circuit-open";
      return null;
    },
    onTrying: (name, remainingMs) => {
      logger.info(`[transcribe] Trying ${name}`, {
        lang: effectiveLang,
        tier,
        timeoutMs: Math.min(entry(name).timeoutMs, remainingMs),
      });
    },
    invoke: (name, attemptSignal) =>
      entry(name).fn(audioBlob, effectiveLang, env, attemptSignal),
    handleAttempt: async (name, attempt) => {
      if (!attempt) {
        // Answered with nothing: neutral, not a provider fault.
        reportProviderNeutral(name);
        logger.info(`[transcribe] ${name} returned null (no result)`);
        return false;
      }

      const shapeCheck = transcribeResponseSchema.safeParse(attempt);
      if (!shapeCheck.success) {
        logger.warn(`[transcribe] ${name} returned a malformed result`, {
          issues: shapeCheck.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return false;
      }

      if (
        isAuto &&
        attempt.language &&
        !validateTranscriptLanguage(attempt.text, attempt.language)
      ) {
        // Keep the transcript; a slightly-off label is cheaper than a 503.
        logger.warn(`[transcribe] ${name} language label disagreed`, {
          reported: attempt.language,
        });
      }

      if (isAuto && !attempt.language) {
        try {
          const detected = await detectTextLanguage(attempt.text, env, signal);
          if (detected) {
            attempt = { ...attempt, language: detected };
            logger.info(
              `[transcribe] ${name} had no language — worker detected ${detected}`,
            );
          }
        } catch (err) {
          logger.error(
            `[transcribe] Language detection fallback failed: ${String(err)}`,
          );
        }
      }

      logger.info(`[transcribe] Success: ${name}`, {
        lang: attempt.language,
        provider: attempt.provider,
      });

      await reportProviderOutcome(env, name, true);

      return true;
    },
    onRejectedResult: (name, result) => {
      if (result) {
        logger.warn(`[transcribe] ${name} produced an unusable result`);
      }
    },
    onAttemptError: (name) => reportProviderOutcome(env, name, false),
  });

  return result;
}
