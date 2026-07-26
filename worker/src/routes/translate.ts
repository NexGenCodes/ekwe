import { logger } from "../logger";
import { getTranslateProviderNames, getLimits } from "../config";
import * as cloudflare from "../providers/cloudflare";
import * as cohere from "../providers/cohere";
import * as gemini from "../providers/gemini";
import * as groq from "../providers/groq";
import * as mistral from "../providers/mistral";
import * as openrouter from "../providers/openrouter";
import { detectTextLanguage } from "../autoDetect";
import {
  guardTextLength,
  guardAutoDetect,
  guardLanguageCode,
  safeParseJSON,
  sanitizeTranslationText,
  getLanguageName,
} from "../security";
import { hashKey } from "../utils/keys";
import { CLIENT_ABORTED, Env, Tier, TranslateResult } from "../types";

type TranslateFn = (
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
) => Promise<TranslateResult | null>;

const TRANSLATE_PROVIDER_MODULES: Record<string, TranslateFn> = {
  gemini: gemini.translate,
  cohere: cohere.translate,
  mistral: mistral.translate,
  groq: groq.translate,
  openrouter: openrouter.translate,
  cloudflare: cloudflare.translate,
};

function buildTranslatePipeline(tier: Tier): { name: string; fn: TranslateFn }[] {
  return getTranslateProviderNames(tier)
    .filter((name) => name in TRANSLATE_PROVIDER_MODULES)
    .map((name) => ({ name, fn: TRANSLATE_PROVIDER_MODULES[name] }));
}

const PREMIUM_PIPELINE = buildTranslatePipeline('PREMIUM');
const FREE_PIPELINE = buildTranslatePipeline('FREE');

export async function handleTranslate(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  const parsed = await safeParseJSON<{
    text: string;
    targetLang: string;
    sourceLang?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.text?.trim()) {
    return Response.json({ error: "EKWE_EMPTY_TRANSCRIPT" }, { status: 400 });
  }

  const textGuard = guardTextLength(body.text, tier);
  if (!textGuard.allowed) return textGuard.response;

  const autoGuard = guardAutoDetect(body.sourceLang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const srcLangGuard = guardLanguageCode(body.sourceLang, "sourceLang");
  if (!srcLangGuard.allowed) return srcLangGuard.response;

  const tgtLangGuard = guardLanguageCode(body.targetLang, "targetLang");
  if (!tgtLangGuard.allowed) return tgtLangGuard.response;

  const cleanText = sanitizeTranslationText(body.text);

  let cacheKey: string;
  try {
    const textHash = await hashKey(
      `${cleanText}_${body.sourceLang || "auto"}_${body.targetLang}`,
    );
    cacheKey = `trans:${textHash}`;
    const cached = await env.EKWE_KV.get(cacheKey);
    if (cached) {
      logger.info(`[translate] KV Cache Hit for hash ${textHash}`);
      const cachedResult = JSON.parse(cached) as TranslateResult;
      return Response.json(cachedResult);
    }
  } catch (err) {
    logger.error(`[translate] KV cache lookup error (Failing closed)`, {
      error: String(err),
    });
    return Response.json(
      {
        error: "EKWE_ALL_PROVIDERS_FAIL",
        message: "Service temporarily unavailable. Please try again later.",
      },
      { status: 503 },
    );
  }

  const pipeline = tier === "PREMIUM" ? PREMIUM_PIPELINE : FREE_PIPELINE;

  const isAuto = !body.sourceLang || body.sourceLang === "auto";
  const detectPromise = isAuto
    ? detectTextLanguage(cleanText, env.AI, env.EKWE_KV, signal).catch(
        () => null as string | null,
      )
    : null;

  for (const provider of pipeline) {
    try {
      if (signal.aborted) throw new Error(CLIENT_ABORTED);
      const targetName = getLanguageName(body.targetLang);
      const sourceName = getLanguageName(body.sourceLang);

      let result = await provider.fn(
        cleanText,
        targetName,
        sourceName,
        env,
        signal,
      );
      if (!result && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 100));
        result = await provider.fn(
          cleanText,
          targetName,
          sourceName,
          env,
          signal,
        );
      }
      if (result) {
        logger.info(`[translate] Success: ${provider.name}`, {
          provider: result.provider,
        });

        const limits = getLimits(tier);
        const r = result as unknown as Record<string, unknown>;
        if (!limits.transliterationAllowed && "transliteration" in r) {
          delete r.transliteration;
        }

        if (limits.autoDetectAllowed && detectPromise) {
          const detected = await detectPromise;
          if (detected) {
            result.language = detected;
          }
        } else if (!limits.autoDetectAllowed && "language" in r) {
          delete r.language;
        }

        try {
          await env.EKWE_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 30 * 24 * 60 * 60,
          });
        } catch (err) {
          logger.error(`[translate] KV cache write error`, {
            error: String(err),
          });
        }

        return Response.json(result);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
      logger.error(`[translate] ${provider.name} failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({ error: "EKWE_ALL_PROVIDERS_FAIL" }, { status: 503 });
}
