import { Env, Tier, TranslateResult } from './types';
import { logger } from './logger';
import { guardTextLength, guardAutoDetect, guardLanguageCode, safeParseJSON, sanitizeTranslationText, getLanguageName } from './security';
import * as groq from './providers/groq';
import * as mistral from './providers/mistral';
import * as openrouter from './providers/openrouter';
import * as cloudflare from './providers/cloudflare';
import * as gemini from './providers/gemini';
import * as cohere from './providers/cohere';

// ─── Translation Provider Signature ───────────────────────────────

type TranslateFn = (
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
) => Promise<TranslateResult | null>;

// ─── Tier-based Pipeline Definitions ──────────────────────────────

const PREMIUM_PIPELINE: Array<{ name: string; fn: TranslateFn }> = [
  { name: 'gemini', fn: gemini.translate },
  { name: 'cohere', fn: cohere.translate },
  { name: 'mistral', fn: mistral.translate },
  { name: 'groq', fn: groq.translate },
  { name: 'openrouter', fn: openrouter.translate },
  { name: 'cloudflare', fn: cloudflare.translate },
];

const FREE_PIPELINE: Array<{ name: string; fn: TranslateFn }> = [
  { name: 'groq', fn: groq.translate },
  { name: 'gemini', fn: gemini.translate },
  { name: 'cohere', fn: cohere.translate },
  { name: 'openrouter', fn: openrouter.translate },
  { name: 'cloudflare', fn: cloudflare.translate },
];

// ─── Orchestrator ─────────────────────────────────────────────────

export async function handleTranslate(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  // ── Safe JSON parsing (prevents 500 on malformed body) ──
  const parsed = await safeParseJSON<{ text: string; targetLang: string; sourceLang?: string }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.text?.trim()) {
    return Response.json({ error: 'EKWE_EMPTY_TRANSCRIPT' }, { status: 400 });
  }

  // ── Security Guards (centralized in security.ts) ──
  const textGuard = guardTextLength(body.text, tier);
  if (!textGuard.allowed) return textGuard.response;

  const autoGuard = guardAutoDetect(body.sourceLang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const srcLangGuard = guardLanguageCode(body.sourceLang, 'sourceLang');
  if (!srcLangGuard.allowed) return srcLangGuard.response;

  const tgtLangGuard = guardLanguageCode(body.targetLang, 'targetLang');
  if (!tgtLangGuard.allowed) return tgtLangGuard.response;

  // ── Prompt Injection Defense (silent strip) ──
  const cleanText = sanitizeTranslationText(body.text);

  const pipeline = tier === 'PREMIUM' ? PREMIUM_PIPELINE : FREE_PIPELINE;

  for (const provider of pipeline) {
    try {
      if (signal.aborted) throw new Error('CLIENT_ABORTED');
      const targetName = getLanguageName(body.targetLang);
      const sourceName = getLanguageName(body.sourceLang);

      const result = await provider.fn(cleanText, targetName, sourceName, env, signal);
      if (result) {
        logger.info(`[translate] Success: ${provider.name}`, { provider: result.provider });
        return Response.json(result);
      }

    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'CLIENT_ABORTED') throw e;
      logger.error(`[translate] ${provider.name} failed`, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, { status: 503 });
}
