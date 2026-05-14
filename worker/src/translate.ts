import { Env, Tier, TranslateResult } from './types';
import { logger } from './logger';
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
  const body = (await request.json()) as {
    text: string;
    targetLang: string;
    sourceLang?: string;
  };

  if (!body.text?.trim()) {
    return Response.json({ error: 'EKWE_EMPTY_TRANSCRIPT' }, { status: 400 });
  }

  const pipeline = tier === 'PREMIUM' ? PREMIUM_PIPELINE : FREE_PIPELINE;

  for (const provider of pipeline) {
    try {
      if (signal.aborted) throw new Error('CLIENT_ABORTED');
      logger.info(`[translate] Trying ${provider.name}`, { tier });

      const result = await provider.fn(body.text, body.targetLang, body.sourceLang, env, signal);
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
