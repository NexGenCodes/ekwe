import { WORKER_ERROR_CODES, translateRequestSchema } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { TRANSLATE_TOTAL_MS } from "@/core/budgets";
import { getLimits } from "@/core/limits";
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
import { Env, Tier } from "@/core/types";
import { runTranslateJob } from "@/services/translate";

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

  let cacheKey: string | null = null;
  let textHash = "";
  try {
    textHash = await hashKey(
      `${cleanText}_${sourceLang || "auto"}_${targetLang}`,
    );
    cacheKey = `trans:${userId}:${tier}:${textHash}`;
  } catch (err) {
    logger.error(`[translate] cache key error (continuing)`, {
      error: String(err),
    });
  }

  const result = await runTranslateJob({
    env,
    tier,
    userId,
    ctx,
    signal,
    text: cleanText,
    sourceLang,
    targetLang,
    wantTransliteration:
      getLimits(tier).transliterationAllowed && needsRomanization(targetLang),
    cacheKey,
    textHash,
    budgetMs: TRANSLATE_TOTAL_MS,
    logPrefix: "[translate]",
  });

  if (result) return Response.json(result);

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}
