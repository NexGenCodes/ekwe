import { transcribeResponseSchema } from "@ekwe/shared";
import { logger } from "@/core/logger";
import {
  getProviderModule,
  getProviderNamesFor,
  providerSupportsLanguage,
} from "@/providers";
import { PROVIDER_SKIP_AUTO, PROVIDER_TIMEOUT } from "@/core/providers";
import { TRANSCRIBE_CACHE_TTL_SECONDS } from "@/core/budgets";
import { getLimits } from "@/core/limits";
import { d1Get, d1Put } from "@/services/d1-cache";
import { runProviderFailover } from "@/utils/retry";
import { isProviderDegraded, reportProviderOutcome } from "@/services/health";
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

export function stripTranscriptLanguage(
  result: TranscribeResult,
  tier: Tier,
): TranscribeResult {
  const limits = getLimits(tier);
  if (!limits.autoDetectAllowed && "language" in result) {
    const r = { ...result };
    delete r.language;
    return r;
  }
  return result;
}

interface PipelineEntry {
  name: string;
  skipOnAuto: boolean;
  timeoutMs: number;
  fn: SttFn;
}

function buildPipeline(
  names: readonly string[],
  tier: "free" | "premium",
): PipelineEntry[] {
  return names.map((name) => ({
    name,
    skipOnAuto: PROVIDER_SKIP_AUTO[name] ?? false,
    timeoutMs:
      PROVIDER_TIMEOUT[name as keyof typeof PROVIDER_TIMEOUT]?.[tier] ?? 15_000,
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
  tier: Tier;
  env: Env;
  signal: AbortSignal;
  budgetMs: number;
}

export async function runTranscribe(
  options: TranscribeOptions,
): Promise<TranscribeResult | null> {
  const { audioBlob, effectiveLang, isAuto, tier, env, signal, budgetMs } =
    options;

  const pipeline = tier === "FREE" ? FREE_PIPELINE : PREMIUM_PIPELINE;

  logger.info(
    `[transcribe] Starting provider pipeline, pipeline has ${pipeline.length} providers`,
  );
  const byName = new Map(pipeline.map((p) => [p.name, p]));
  const entry = (name: string): PipelineEntry => {
    const e = byName.get(name);
    if (!e) throw new Error(`[transcribe] Unknown provider: ${name}`);
    return e;
  };

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
      if (await isProviderDegraded(env, name)) {
        logger.info(`[transcribe] Skipping ${name} (circuit open)`);
        return true;
      }
      const e = entry(name);
      if (isAuto && e.skipOnAuto) {
        logger.info(`[transcribe] Skipping ${name} (skipOnAuto)`);
        return true;
      }
      if (!isAuto && !providerSupportsLanguage(name, "stt", effectiveLang)) {
        logger.info(
          `[transcribe] Skipping ${name} (unsupported language: ${effectiveLang})`,
        );
        return true;
      }
      return false;
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
        await reportProviderOutcome(env, name, false);
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
        logger.info(`[transcribe] ${name} rejected (language mismatch)`);
        return false;
      }

      if (isAuto && !attempt.language) {
        try {
          const detected = await detectTextLanguage(
            attempt.text,
            env.EKWE_D1,
            signal,
          );
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
    onAttemptError: (name) => reportProviderOutcome(env, name, false),
  });

  return result;
}
