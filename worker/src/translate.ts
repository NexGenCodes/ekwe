import { logger } from "./logger";
import * as cloudflare from "./providers/cloudflare";
import * as cohere from "./providers/cohere";
import * as gemini from "./providers/gemini";
import * as groq from "./providers/groq";
import * as mistral from "./providers/mistral";
import * as openrouter from "./providers/openrouter";
import { detectTextLanguage } from "./autoDetect";
import {
  guardTextLength,
  guardAutoDetect,
  guardLanguageCode,
  safeParseJSON,
  sanitizeTranslationText,
  getLanguageName,
} from "./security";
import { Env, Tier, TranslateResult } from "./types";

// ─── Translation Provider Signature ───────────────────────────────

type TranslateFn = (
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
) => Promise<TranslateResult | null>;

// ─── Tier-based Pipeline Definitions ──────────────────────────────

const PREMIUM_PIPELINE: { name: string; fn: TranslateFn }[] = [
  { name: "gemini", fn: gemini.translate },
  { name: "cohere", fn: cohere.translate },
  { name: "mistral", fn: mistral.translate },
  { name: "groq", fn: groq.translate },
  { name: "openrouter", fn: openrouter.translate },
  { name: "cloudflare", fn: cloudflare.translate },
];

const FREE_PIPELINE: { name: string; fn: TranslateFn }[] = [
  { name: "groq", fn: groq.translate },
  { name: "gemini", fn: gemini.translate },
  { name: "cohere", fn: cohere.translate },
  { name: "openrouter", fn: openrouter.translate },
  { name: "cloudflare", fn: cloudflare.translate },
];

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Orchestrator ─────────────────────────────────────────────────

export async function handleTranslate(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  // ── Safe JSON parsing (prevents 500 on malformed body) ──
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

  // ── Security Guards (centralized in security.ts) ──
  const textGuard = guardTextLength(body.text, tier);
  if (!textGuard.allowed) return textGuard.response;

  const autoGuard = guardAutoDetect(body.sourceLang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const srcLangGuard = guardLanguageCode(body.sourceLang, "sourceLang");
  if (!srcLangGuard.allowed) return srcLangGuard.response;

  const tgtLangGuard = guardLanguageCode(body.targetLang, "targetLang");
  if (!tgtLangGuard.allowed) return tgtLangGuard.response;

  // ── Prompt Injection Defense (silent strip) ──
  const cleanText = sanitizeTranslationText(body.text);

  // ── KV Cache Lookup (Fail-Closed) ──
  let cacheKey: string;
  try {
    const textHash = await sha256(
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

  // Kick off parallel language detection when source is auto
  const isAuto = !body.sourceLang || body.sourceLang === "auto";
  const detectPromise = isAuto
    ? detectTextLanguage(cleanText, env.AI, env.EKWE_KV, signal).catch(
        () => null as string | null,
      )
    : null;

  for (const provider of pipeline) {
    try {
      if (signal.aborted) throw new Error("CLIENT_ABORTED");
      const targetName = getLanguageName(body.targetLang);
      const sourceName = getLanguageName(body.sourceLang);

      const result = await provider.fn(
        cleanText,
        targetName,
        sourceName,
        env,
        signal,
      );
      if (result) {
        logger.info(`[translate] Success: ${provider.name}`, {
          provider: result.provider,
        });

        // Add detected language if detection was requested
        if (detectPromise) {
          const detected = await detectPromise;
          if (detected) {
            result.language = detected;
          }
        }

        // Write to cache (best-effort — fail-open so the user still gets their translation)
        try {
          await env.EKWE_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 30 * 24 * 60 * 60,
          }); // 30 days
        } catch (err) {
          logger.error(`[translate] KV cache write error`, {
            error: String(err),
          });
        }

        return Response.json(result);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "CLIENT_ABORTED") throw e;
      logger.error(`[translate] ${provider.name} failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({ error: "EKWE_ALL_PROVIDERS_FAIL" }, { status: 503 });
}
