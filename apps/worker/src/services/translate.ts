import {
  getLanguageName,
  skipReason,
  translateResponseSchema,
} from "@ekwe/shared";
import { logger } from "@/core/logger";
import {
  TRANSLATE_CACHE_TTL_SECONDS,
  TRANSLATE_PER_PROVIDER_MS,
} from "@/core/budgets";
import { getLimits } from "@/core/limits";
import { getProviderModule, getProviderNamesFor } from "@/providers";
import {
  detectTextLanguage,
  validateTranscriptLanguage,
} from "@/services/auto-detect";
import { d1Get, d1Put } from "@/services/d1-cache";
import { isProviderDegraded, reportProviderOutcome } from "@/services/health";
import { trackBillableSuccess } from "@/services/usage";
import { runProviderFailover } from "@/utils/retry";
import {
  CLIENT_ABORTED,
  Env,
  Tier,
  TranslateFn,
  TranslateResult,
} from "@/core/types";

export function buildTranslateCacheKey(
  userId: string,
  tier: string,
  textHash: string,
): string {
  return `trans:${userId}:${tier}:${textHash}`;
}

export interface TranslateJob {
  env: Env;
  tier: Tier;
  userId: string;
  ctx: ExecutionContext | undefined;
  signal: AbortSignal;
  text: string;
  sourceLang: string | undefined;
  targetLang: string;
  /**
   * Synthesis speaks the target script, so it never asks for a romanization
   * that would then have to be stripped back out again.
   */
  wantTransliteration: boolean;
  /** Null disables the D1 read and write, for one-off internal calls. */
  cacheKey: string | null;
  textHash: string;
  budgetMs: number;
  /** Distinguishes the two callers in logs. */
  logPrefix: string;
}

export async function runTranslateJob(
  job: TranslateJob,
): Promise<TranslateResult | null> {
  const {
    env,
    tier,
    userId,
    ctx,
    signal,
    text,
    sourceLang,
    targetLang,
    wantTransliteration,
    cacheKey,
    textHash,
    budgetMs,
    logPrefix,
  } = job;
  const limits = getLimits(tier);

  if (cacheKey && env.EKWE_D1) {
    try {
      const cached = await d1Get(env.EKWE_D1, "cache_translation", cacheKey);
      if (cached) {
        const cachedResult = JSON.parse(cached) as TranslateResult;
        const shapeCheck = translateResponseSchema.safeParse(cachedResult);
        if (shapeCheck.success) {
          logger.info(`${logPrefix} translate cache hit (${textHash})`);
          return cachedResult;
        }
        logger.warn(`${logPrefix} translate cache entry failed validation`, {
          textHash,
          issues: shapeCheck.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
    } catch (err) {
      logger.error(`${logPrefix} translate cache lookup error (continuing)`, {
        error: String(err),
      });
    }
  }

  const isAuto = !sourceLang || sourceLang === "auto";
  let detectedLang: string | null = null;
  if (isAuto) {
    try {
      detectedLang = await detectTextLanguage(text, env.EKWE_D1, signal);
    } catch {
      // Detection failure is non-fatal: providers can still translate.
    }
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
  }

  const byName = new Map<string, TranslateFn>(
    getProviderNamesFor("translate", tier).map((name) => [
      name,
      getProviderModule(name)?.translate ?? (() => Promise.resolve(null)),
    ]),
  );

  const targetName = getLanguageName(targetLang);
  const sourceName = isAuto
    ? detectedLang
      ? getLanguageName(detectedLang)
      : undefined
    : getLanguageName(sourceLang);

  return runProviderFailover<TranslateResult>({
    providers: [...byName.keys()],
    signal,
    totalMs: budgetMs,
    route: "translate",
    env,
    tier,
    attemptTimeoutMs: () => TRANSLATE_PER_PROVIDER_MS,
    shouldSkip: async (name) => {
      if (await isProviderDegraded(env, name)) {
        logger.info(`[translate] Skipping ${name} (circuit open)`);
        return true;
      }
      // Skipping a provider that cannot write the target language is what keeps
      // an unwritable request from burning a paid call before the next provider.
      if (skipReason(name, "translate", targetLang)) {
        logger.info(`[translate] Skipping ${name} (no ${targetLang})`);
        return true;
      }
      return false;
    },
    invoke: (name, attemptSignal) => {
      const fn = byName.get(name);
      if (!fn) throw new Error(`[translate] Unknown provider: ${name}`);
      return fn(
        text,
        targetName,
        sourceName,
        env,
        attemptSignal,
        wantTransliteration,
      );
    },
    handleAttempt: async (name, attempt) => {
      if (!attempt) {
        await reportProviderOutcome(env, name, false);
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

      if (!validateTranscriptLanguage(attempt.translation, targetLang)) {
        logger.warn(`[translate] ${name} did not return ${targetLang}`, {
          provider: attempt.provider,
          targetLang,
          sample: attempt.translation.slice(0, 80),
        });
        return false;
      }

      const r = attempt as unknown as Record<string, unknown>;
      if (!limits.transliterationAllowed && "transliteration" in r) {
        delete r.transliteration;
      }
      if (limits.autoDetectAllowed && detectedLang) {
        attempt.language = detectedLang;
      } else if (!limits.autoDetectAllowed && "language" in r) {
        delete r.language;
      }

      if (cacheKey && env.EKWE_D1) {
        try {
          await d1Put(
            env.EKWE_D1,
            "cache_translation",
            cacheKey,
            userId,
            tier,
            JSON.stringify(attempt),
            TRANSLATE_CACHE_TTL_SECONDS,
          );
        } catch (err) {
          logger.error(`${logPrefix} translate cache write error`, {
            error: String(err),
          });
        }
      }

      trackBillableSuccess(env, userId, "translate", ctx);
      await reportProviderOutcome(env, name, true);
      return true;
    },
    onAttemptError: (name) => reportProviderOutcome(env, name, false),
  });
}
