import { translateResponseSchema } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { getProviderModule, getProviderNamesFor } from "@/providers";
import { PROVIDER_TIMEOUT } from "@/core/providers";
import { logSkips, planTttRoute } from "@/core/route-eligibility";
import {
  FALLBACK_ATTEMPT_TIMEOUT_MS,
  TRANSLATE_CACHE_TTL_SECONDS,
} from "@/core/budgets";
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
import {
  CLIENT_ABORTED,
  Env,
  Tier,
  TranslateResult,
  TttFn,
} from "@/core/types";

export async function readTranslateCache(
  env: Env,
  cacheKey: string,
): Promise<TranslateResult | null> {
  if (!env.EKWE_D1) return null;
  try {
    const cached = await d1Get(env.EKWE_D1, "cache_translation", cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as TranslateResult;
      const shapeCheck = translateResponseSchema.safeParse(parsed);
      if (shapeCheck.success) return parsed;
      logger.warn(`[translate] D1 cache entry failed validation: ${cacheKey}`);
    }
  } catch (err) {
    logger.error(`[translate] D1 cache lookup error (continuing)`, {
      error: String(err),
    });
  }
  return null;
}

export async function writeTranslateCache(
  env: Env,
  cacheKey: string,
  userId: string,
  tier: string,
  result: TranslateResult,
): Promise<void> {
  if (!env.EKWE_D1) return;
  try {
    await d1Put(
      env.EKWE_D1,
      "cache_translation",
      cacheKey,
      userId,
      tier,
      JSON.stringify(result),
      TRANSLATE_CACHE_TTL_SECONDS,
    );
  } catch (err) {
    logger.error(`[translate] D1 cache write error`, { error: String(err) });
  }
}

export function buildTranslateCacheKey(
  userId: string,
  tier: string,
  textHash: string,
): string {
  return `trans:${userId}:${tier}:${textHash}`;
}

/** Removes plan-gated fields so the provider never learns they are metered. */
export function stripTranslationTier(
  result: TranslateResult,
  tier: Tier,
): TranslateResult {
  const r = { ...result };
  if (!getLimits(tier).transliterationAllowed) delete r.transliteration;
  if (!getLimits(tier).autoDetectAllowed) delete r.language;
  return r;
}

interface PipelineEntry {
  name: string;
  timeoutMs: number;
  fn: TttFn;
}

function buildPipeline(names: readonly string[], tier: "free" | "premium") {
  return names.map((name) => ({
    name,
    timeoutMs:
      PROVIDER_TIMEOUT[name as keyof typeof PROVIDER_TIMEOUT]?.[tier] ??
      FALLBACK_ATTEMPT_TIMEOUT_MS.translate,
    fn: getProviderModule(name)?.ttt ?? (() => Promise.resolve(null)),
  }));
}

const FREE_PIPELINE = buildPipeline(getProviderNamesFor("ttt", "FREE"), "free");
const PREMIUM_PIPELINE = buildPipeline(
  getProviderNamesFor("ttt", "PREMIUM"),
  "premium",
);

export interface TranslateOptions {
  env: Env;
  tier: Tier;
  signal: AbortSignal;
  text: string;
  targetLang: string;
  sourceLang: string | undefined;
  wantTransliteration: boolean;
  budgetMs: number;
}

export async function runTranslate(
  options: TranslateOptions,
): Promise<TranslateResult | null> {
  const {
    env,
    tier,
    signal,
    text,
    targetLang,
    sourceLang,
    wantTransliteration,
    budgetMs,
  } = options;

  const pipeline = tier === "FREE" ? FREE_PIPELINE : PREMIUM_PIPELINE;

  const byName = new Map(pipeline.map((p) => [p.name, p]));
  const entry = (name: string): PipelineEntry => {
    const e = byName.get(name);
    if (!e) throw new Error(`[translate] Unknown provider: ${name}`);
    return e;
  };

  // Auto-detect is the service's job; providers get the resolved source.
  const isAuto = !sourceLang || sourceLang === "auto";
  let detected: string | null = null;
  if (isAuto) {
    try {
      detected = await detectTextLanguage(text, env, signal);
    } catch {
      // Detection failure is non-fatal: providers can still translate.
    }
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
  }

  const plan = planTttRoute(
    pipeline.map((p) => p.name),
    {
      targetLang,
      textLength: text.length,
    },
  );
  const planByProvider = new Map(plan.map((a) => [a.provider, a]));
  logSkips("translate", plan);

  // First valid answer, boxed because it is assigned inside the callback.
  const firstAnswer: { value: TranslateResult | null } = { value: null };

  const result = await runProviderFailover<TranslateResult>({
    providers: pipeline.map((p) => p.name),
    signal,
    totalMs: budgetMs,
    route: "translate",
    env,
    tier,
    attemptTimeoutMs: (name, remainingMs) =>
      Math.min(entry(name).timeoutMs, remainingMs),
    shouldSkip: async (name) => {
      const planned = planByProvider.get(name);
      if (planned && !planned.eligible) return planned.reason ?? null;
      if (await isProviderDegraded(env, name)) return "circuit-open";
      return null;
    },
    onTrying: (name, remainingMs) => {
      logger.info(`[translate] Trying ${name}`, {
        targetLang,
        timeoutMs: Math.min(entry(name).timeoutMs, remainingMs),
      });
    },
    invoke: (name, attemptSignal) => {
      const fn = entry(name).fn;
      return fn(
        text,
        {
          targetLang,
          sourceLang: isAuto ? detected || "auto" : sourceLang,
          transliteration: wantTransliteration,
        },
        env,
        attemptSignal,
      );
    },
    handleAttempt: async (name, attempt) => {
      if (!attempt) {
        reportProviderNeutral(name);
        logger.info(`[translate] ${name} returned null (no result)`);
        return false;
      }

      const shapeCheck = translateResponseSchema.safeParse(attempt);
      if (!shapeCheck.success) {
        logger.warn(`[translate] ${name} returned a malformed result`, {
          issues: shapeCheck.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return false;
      }

      if (!firstAnswer.value) firstAnswer.value = attempt;

      if (!validateTranscriptLanguage(attempt.translation, targetLang)) {
        // Romanised targets (zh, ja, hi, ko, ar, th) fail here by design; keep
        // looking, but remember the answer.
        logger.warn(
          `[translate] ${name} output did not look like ${targetLang}`,
          {
            provider: attempt.provider,
            targetLang,
            sample: attempt.translation.slice(0, 80),
          },
        );
        return false;
      }

      if (detected) attempt.language = detected;

      await reportProviderOutcome(env, name, true);
      logger.info(`[translate] Success: ${name}`, {
        lang: attempt.language,
        provider: attempt.provider,
      });
      return true;
    },
    onRejectedResult: (name, result) => {
      if (result) {
        logger.warn(`[translate] ${name} produced an unusable result`);
      }
    },
    onAttemptError: (name) => reportProviderOutcome(env, name, false),
  });

  if (result) return result;

  const bestEffort = firstAnswer.value;
  if (bestEffort) {
    logger.warn(
      `[translate] No provider wrote ${targetLang}; returning the closest answer`,
      { provider: bestEffort.provider },
    );
    if (detected) bestEffort.language = detected;
    return bestEffort;
  }
  return null;
}
