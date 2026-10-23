import { WORKER_ERROR_CODES, translateRequestSchema } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { TRANSLATE_TOTAL_MS } from "@/core/budgets";
import { getLimits } from "@/core/limits";
import { needsRomanization } from "@ekwe/shared/languages";
import {
  buildTranslateCacheKey,
  readTranslateCache,
  runTranslate,
  stripTranslationTier,
  writeTranslateCache,
} from "@/services/translate";
import { runPreflightGate } from "@/services/preflight";
import { trackBillableSuccess } from "@/services/usage";
import { sanitizeTranslationText } from "@/core/sanitize";
import { hashKey } from "@/utils/keys";
import { Env, Tier } from "@/core/types";
import type { z } from "zod";
import {
  guardTextLength,
  guardAutoDetect,
  guardLanguageCode,
  guardSupportedLanguage,
} from "@/core/guards";
import { getTranslateProviderNames } from "@/core/providers";

export async function handleTranslate(
  body: z.infer<typeof translateRequestSchema>,
  env: Env,
  tier: Tier,
  pipelineTier: Tier,
  signal: AbortSignal,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const { text, sourceLang, targetLang } = body;

  const charge = (chars: number): void => {
    trackBillableSuccess(env, userId, "translate", ctx, chars);
  };

  if (!text.trim()) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }

  const textGuard = guardTextLength(text, tier);
  if (!textGuard.allowed) {
    return textGuard.response;
  }

  const autoGuard = guardAutoDetect(sourceLang, tier);
  if (!autoGuard.allowed) {
    return autoGuard.response;
  }

  const srcLangGuard = guardLanguageCode(sourceLang, "sourceLang");
  if (!srcLangGuard.allowed) {
    return srcLangGuard.response;
  }

  const tgtLangGuard = guardLanguageCode(targetLang, "targetLang");
  if (!tgtLangGuard.allowed) {
    return tgtLangGuard.response;
  }

  const srcSupportGuard = guardSupportedLanguage(
    sourceLang,
    "ttt",
    getTranslateProviderNames(pipelineTier),
  );
  if (!srcSupportGuard.allowed) {
    return srcSupportGuard.response;
  }

  const tgtSupportGuard = guardSupportedLanguage(
    targetLang,
    "ttt",
    getTranslateProviderNames(pipelineTier),
  );
  if (!tgtSupportGuard.allowed) {
    return tgtSupportGuard.response;
  }

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

  // The middleware gate cannot see the body. Re-check with the real text length
  // so a long request cannot slip past the monthly credit budget.
  const preciseGate = await runPreflightGate(
    env,
    ctx ?? { waitUntil: () => {} },
    userId,
    tier,
    "translate",
    true,
    cleanText.length,
  );
  if (!preciseGate.ok) return preciseGate.response;
  const effectivePipelineTier = preciseGate.tier;

  let cacheKey: string | null = null;
  try {
    const textHash = await hashKey(
      `${cleanText}_${sourceLang || "auto"}_${targetLang}`,
    );
    cacheKey = buildTranslateCacheKey(userId, tier, textHash);

    const cached = await readTranslateCache(env, cacheKey);
    if (cached) {
      return Response.json(stripTranslationTier(cached, tier));
    }
  } catch (err) {
    logger.error(
      `[translate] D1 cache lookup error (continuing): ${String(err)}`,
    );
  }

  const result = await runTranslate({
    env,
    tier: effectivePipelineTier,
    signal,
    text: cleanText,
    targetLang,
    sourceLang,
    wantTransliteration:
      getLimits(tier).transliterationAllowed && needsRomanization(targetLang),
    budgetMs: TRANSLATE_TOTAL_MS,
  });

  if (result) {
    charge(cleanText.length);
    const prepared = stripTranslationTier(result, tier);
    if (cacheKey && ctx) {
      ctx.waitUntil(writeTranslateCache(env, cacheKey, userId, tier, prepared));
    } else if (cacheKey) {
      await writeTranslateCache(env, cacheKey, userId, tier, prepared);
    }
    return Response.json(prepared);
  }

  logger.error(`[translate] ALL providers failed`);

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}
