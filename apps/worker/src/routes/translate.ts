import {
  WORKER_ERROR_CODES,
  translateRequestSchema,
  translateResponseSchema,
} from "@ekwe/shared";
import { logger } from "../core/logger";
import { getTranslateProviderNames } from "../core/config";
import { getLimits } from "../core/limits";
import * as cloudflare from "../providers/cloudflare";
import * as cohere from "../providers/cohere";
import * as gemini from "../providers/gemini";
import * as groq from "../providers/groq";
import * as mistral from "../providers/mistral";
import * as openrouter from "../providers/openrouter";
import { detectTextLanguage } from "../services/autoDetect";
import { needsRomanization } from "../utils/prompts";
import {
  guardTextLength,
  guardAutoDetect,
  guardLanguageCode,
  safeParseJSON,
} from "../core/guards";
import { sanitizeTranslationText } from "../core/sanitize";
import { getLanguageName } from "../services/languages";
import { hashKey } from "../utils/keys";
import { d1Get, d1Put } from "../services/d1-cache";
import { runProviderFailover } from "../utils/pipeline";
import { trackBillableSuccess } from "../services/usage";
import { CLIENT_ABORTED, Env, Tier, TranslateResult } from "../core/types";

type TranslateFn = (
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
  transliteration: boolean,
) => Promise<TranslateResult | null>;

const TRANSLATE_PROVIDER_MODULES: Record<string, TranslateFn> = {
  gemini: gemini.translate,
  cohere: cohere.translate,
  mistral: mistral.translate,
  groq: groq.translate,
  openrouter: openrouter.translate,
  cloudflare: cloudflare.translate,
};

function buildTranslatePipeline(
  tier: Tier,
): { name: string; fn: TranslateFn }[] {
  return getTranslateProviderNames(tier)
    .filter((name) => name in TRANSLATE_PROVIDER_MODULES)
    .map((name) => ({ name, fn: TRANSLATE_PROVIDER_MODULES[name] }));
}

const PREMIUM_PIPELINE = buildTranslatePipeline("PREMIUM");
const FREE_PIPELINE = buildTranslatePipeline("FREE");

// Hard ceiling for the whole provider failover loop. The mobile client gives
// /translate 60s before surfacing a timeout, so this stays well under it.
const PIPELINE_TOTAL_MS = 20_000;
// Each provider gets a fair share of the budget. Gemini-3.5-flash-lite responds
// in ~1s; fallbacks (cohere, groq) are similarly fast.
const PER_PROVIDER_MS = 10_000;

export async function handleTranslate(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  // Shape gate before tier-aware guards: a malformed body (missing fields,
  // wrong types) would otherwise slip through and throw deep in the handler.
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

  let cacheKey: string;
  try {
    const textHash = await hashKey(
      `${cleanText}_${sourceLang || "auto"}_${targetLang}`,
    );
    // Tier is part of the key so a premium result (which may carry auto-detected
    // `language` / `transliteration` fields the FREE tier isn't entitled to) can
    // never be served to a downgraded FREE user — and a FREE-cached stripped
    // result can never be served to a PREMIUM user who should get the richer
    // response.
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
    // Cache lookup failure is non-fatal — degrade gracefully instead of
    // blocking all translate requests on a transient D1 outage.
    logger.error(`[translate] D1 cache lookup error (continuing)`, {
      error: String(err),
    });
  }

  const pipeline = tier === "PREMIUM" ? PREMIUM_PIPELINE : FREE_PIPELINE;
  const limits = getLimits(tier);

  const isAuto = !sourceLang || sourceLang === "auto";

  // When the source language is "auto", detect it BEFORE calling providers so
  // we can pass the real language code (e.g. "English") instead of the useless
  // string "auto-detected language" into the translation prompt.
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
  // Lookup helper: names come from `pipeline` itself, so a miss is a real
  // misconfiguration — fail loudly instead of hitting `undefined.fn`.
  const entry = (name: string): { name: string; fn: TranslateFn } => {
    const e = byName.get(name);
    if (!e) throw new Error(`[translate] Unknown provider: ${name}`);
    return e;
  };
  const result = await runProviderFailover<TranslateResult>({
    providers: pipeline.map((p) => p.name),
    signal,
    totalMs: PIPELINE_TOTAL_MS,
    route: "translate",
    attemptTimeoutMs: () => PER_PROVIDER_MS,
    invoke: (name, attemptSignal) => {
      const targetName = getLanguageName(targetLang);
      // Use the detected language code when source was "auto", not the
      // display string "auto-detected language". Pass undefined when
      // detection failed so the prompt omits the source hint entirely.
      const sourceName = isAuto
        ? detectedLang
          ? getLanguageName(detectedLang)
          : undefined
        : getLanguageName(sourceLang);
      // Romanization guides are a premium-only feature AND only meaningful
      // when the target language uses a non-Latin script.
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
      if (!attempt) return false;

      // Schema gate: a provider emitting a malformed result (missing/typed
      // fields) is treated as a failed attempt so the pipeline fails over
      // instead of shipping garbage to the client.
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

      // Billable success: counts against the user's daily translate quota.
      // The preflight gate is invalidated so the next request sees the fresh
      // count; KV cache replays never reach this point and stay free.
      trackBillableSuccess(env, userId, "translate", ctx);

      return true;
    },
  });
  if (result) return Response.json(result);

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}
