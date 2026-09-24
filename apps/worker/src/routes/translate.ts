import {
  getLanguageName,
  WORKER_ERROR_CODES,
  translateRequestSchema,
  translateResponseSchema,
} from "@ekwe/shared";
import { logger } from "@/core/logger";
import { TRANSLATE_PER_PROVIDER_MS, TRANSLATE_TOTAL_MS } from "@/core/budgets";
import { getLimits } from "@/core/limits";
import { getProviderModule, getProviderNamesFor } from "@/providers";
import { detectTextLanguage } from "@/services/auto-detect";
import { needsRomanization } from "@/utils/prompts";
import {
  guardTextLength,
  guardAutoDetect,
  guardLanguageCode,
  safeParseJSON,
  guardContentType,
  guardJsonSize,
  MAX_JSON_BODY_BYTES,
} from "@/core/guards";
import { sanitizeTranslationText } from "@/core/sanitize";
import { hashKey } from "@/utils/keys";
import { d1Get, d1Put } from "@/services/d1-cache";
import { runProviderFailover } from "@/utils/retry";
import { isProviderDegraded, reportProviderOutcome } from "@/services/health";
import { trackBillableSuccess } from "@/services/usage";
import {
  CLIENT_ABORTED,
  Env,
  Tier,
  TranslateResult,
  TranslateFn,
} from "@/core/types";

function buildTranslatePipeline(
  tier: Tier,
): { name: string; fn: TranslateFn }[] {
  return getProviderNamesFor("translate", tier)
    .map((name) => ({
      name,
      fn: getProviderModule(name)?.translate ?? (() => Promise.resolve(null)),
    }))
    .filter((entry): entry is { name: string; fn: TranslateFn } =>
      Boolean(entry.fn),
    );
}

const PREMIUM_PIPELINE = buildTranslatePipeline("PREMIUM");
const FREE_PIPELINE = buildTranslatePipeline("FREE");

export async function handleTranslate(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const ctGuard = guardContentType(request);
  if (!ctGuard.allowed) return ctGuard.response;

  const sizeGuard = guardJsonSize(request, MAX_JSON_BODY_BYTES);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const body = translateRequestSchema.safeParse(parsed.data);
  if (!body.success) {
    const firstPath = body.error.issues[0]?.path[0];
    if (firstPath === "targetLang") {
      return Response.json(
        { error: WORKER_ERROR_CODES.INVALID_TARGET_LANGUAGE },
        { status: 400 },
      );
    }
    if (firstPath === "sourceLang") {
      return Response.json(
        { error: WORKER_ERROR_CODES.INVALID_LANGUAGE },
        { status: 400 },
      );
    }
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }
  const { text, sourceLang, targetLang } = body.data;

  if (!text.trim()) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }

  const textGuard = guardTextLength(text, tier);
  if (!textGuard.allowed) return textGuard.response;

  const autoGuard = guardAutoDetect(sourceLang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const srcLangGuard = guardLanguageCode(sourceLang, "sourceLang");
  if (!srcLangGuard.allowed) return srcLangGuard.response;

  const tgtLangGuard = guardLanguageCode(targetLang, "targetLang");
  if (!tgtLangGuard.allowed) return tgtLangGuard.response;

  if (!targetLang || targetLang === "auto") {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.INVALID_TARGET_LANGUAGE,
        message: "A concrete target language is required.",
      },
      { status: 400 },
    );
  }

  const cleanText = sanitizeTranslationText(text);

  if (sourceLang === targetLang) {
    logger.info(
      `[translate] Short-circuiting identical languages (${sourceLang})`,
    );
    return Response.json({
      translation: cleanText,
      provider: "ekwe",
      language: sourceLang,
    });
  }

  let cacheKey: string;
  try {
    const textHash = await hashKey(
      `${cleanText}_${sourceLang || "auto"}_${targetLang}`,
    );
    cacheKey = `trans:${userId}:${tier}:${textHash}`;
    if (env.EKWE_D1) {
      const cached = await d1Get(env.EKWE_D1, "cache_translation", cacheKey);
      if (cached) {
        const cachedResult = JSON.parse(cached) as TranslateResult;
        const shapeCheck = translateResponseSchema.safeParse(cachedResult);
        if (shapeCheck.success) {
          logger.info(`[translate] D1 Cache Hit for hash ${textHash}`);
          return Response.json(cachedResult);
        }
        logger.warn(
          `[translate] D1 cache entry failed validation (ignoring): ${textHash}`,
          {
            issues: shapeCheck.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
        );
      }
    }
  } catch (err) {
    logger.error(`[translate] D1 cache lookup error (continuing)`, {
      error: String(err),
    });
  }

  const pipeline = tier === "PREMIUM" ? PREMIUM_PIPELINE : FREE_PIPELINE;
  const limits = getLimits(tier);

  const isAuto = !sourceLang || sourceLang === "auto";

  let detectedLang: string | null = null;
  if (isAuto) {
    try {
      detectedLang = await detectTextLanguage(cleanText, env.EKWE_D1, signal);
    } catch {
      // Detection failure is non-fatal — providers can still translate.
    }
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
  }

  const byName = new Map(pipeline.map((p) => [p.name, p]));
  const entry = (name: string): { name: string; fn: TranslateFn } => {
    const e = byName.get(name);
    if (!e) throw new Error(`[translate] Unknown provider: ${name}`);
    return e;
  };
  const result = await runProviderFailover<TranslateResult>({
    providers: pipeline.map((p) => p.name),
    signal,
    totalMs: TRANSLATE_TOTAL_MS,
    route: "translate",
    attemptTimeoutMs: () => TRANSLATE_PER_PROVIDER_MS,
    shouldSkip: async (name) => {
      if (await isProviderDegraded(env, name)) {
        logger.info(`[translate] Skipping ${name} (circuit open)`);
        return true;
      }
      return false;
    },
    invoke: (name, attemptSignal) => {
      const targetName = getLanguageName(targetLang);
      const sourceName = isAuto
        ? detectedLang
          ? getLanguageName(detectedLang)
          : undefined
        : getLanguageName(sourceLang);
      const wantTransliteration =
        limits.transliterationAllowed && needsRomanization(targetLang);
      return entry(name).fn(
        cleanText,
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

      logger.info(`[translate] Success: ${name}`, {
        provider: attempt.provider,
      });

      const r = attempt as unknown as Record<string, unknown>;
      if (!limits.transliterationAllowed && "transliteration" in r) {
        delete r.transliteration;
      }

      if (limits.autoDetectAllowed && detectedLang) {
        attempt.language = detectedLang;
      } else if (!limits.autoDetectAllowed && "language" in r) {
        delete r.language;
      }

      try {
        if (env.EKWE_D1) {
          await d1Put(
            env.EKWE_D1,
            "cache_translation",
            cacheKey,
            userId,
            tier,
            JSON.stringify(attempt),
            4 * 60 * 60,
          );
        }
      } catch (err) {
        logger.error(`[translate] D1 cache write error`, {
          error: String(err),
        });
      }

      trackBillableSuccess(env, userId, "translate", ctx);

      await reportProviderOutcome(env, name, true);

      return true;
    },
    onAttemptError: (name) => reportProviderOutcome(env, name, false),
  });
  if (result) return Response.json(result);

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}
