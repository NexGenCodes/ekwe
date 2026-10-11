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
import { releaseUsage } from "@/services/usage";
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
  const refund = () => releaseUsage(env, userId, "translate", ctx);

  if (!text.trim()) {
    refund();
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }

  const textGuard = guardTextLength(text, tier);
  if (!textGuard.allowed) {
    refund();
    return textGuard.response;
  }

  const autoGuard = guardAutoDetect(sourceLang, tier);
  if (!autoGuard.allowed) {
    refund();
    return autoGuard.response;
  }

  const srcLangGuard = guardLanguageCode(sourceLang, "sourceLang");
  if (!srcLangGuard.allowed) {
    refund();
    return srcLangGuard.response;
  }

  const tgtLangGuard = guardLanguageCode(targetLang, "targetLang");
  if (!tgtLangGuard.allowed) {
    refund();
    return tgtLangGuard.response;
  }

  // Both directions must be servable, and separately: an unservable *source*
  // means nothing can transcribe it, while an unservable *target* means nothing
  // can translate into it. Reporting one as an outage would be a lie either way.
  const srcSupportGuard = guardSupportedLanguage(sourceLang, "stt");
  if (!srcSupportGuard.allowed) {
    refund();
    return srcSupportGuard.response;
  }

  const tgtSupportGuard = guardSupportedLanguage(targetLang, "ttt");
  if (!tgtSupportGuard.allowed) {
    refund();
    return tgtSupportGuard.response;
  }

  if (!targetLang || targetLang === "auto") {
    refund();
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
    refund();
    return Response.json({
      translation: cleanText,
      provider: "ekwe",
      language: sourceLang,
    });
  }

  let cacheKey: string | null = null;
  try {
    const textHash = await hashKey(
      `${cleanText}_${sourceLang || "auto"}_${targetLang}`,
    );
    cacheKey = buildTranslateCacheKey(userId, tier, textHash);

    const cached = await readTranslateCache(env, cacheKey);
    if (cached) {
      refund();
      return Response.json(stripTranslationTier(cached, tier));
    }
  } catch (err) {
    logger.error(
      `[translate] D1 cache lookup error (continuing): ${String(err)}`,
    );
  }

  const result = await runTranslate({
    env,
    tier: pipelineTier,
    signal,
    text: cleanText,
    targetLang,
    sourceLang,
    wantTransliteration:
      getLimits(tier).transliterationAllowed && needsRomanization(targetLang),
    budgetMs: TRANSLATE_TOTAL_MS,
  });

  if (result) {
    const prepared = stripTranslationTier(result, tier);
    if (cacheKey) {
      await writeTranslateCache(env, cacheKey, userId, tier, prepared);
    }
    return Response.json(prepared);
  }

  logger.error(`[translate] ALL providers failed`);
  refund();

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}
