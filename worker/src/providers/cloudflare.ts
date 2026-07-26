import { Env, TranscribeResult, TranslateResult } from '../types';
import { isHallucination, buildTranslatePrompt } from '../utils/prompts';
import { logger } from '../logger';

/**
 * Cloudflare Workers AI — zero-key safety net.
 * Uses AI binding directly, no API keys needed.
 */

// ─── Transcription (@cf/openai/whisper) ───────────────────────────

export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  _signal: AbortSignal,
): Promise<TranscribeResult | null> {
  try {
    const audio = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const input = lang && lang !== 'auto'
      ? { audio, language: lang }
      : { audio };
    const result = await env.AI.run('@cf/openai/whisper', input);
    const text = typeof result?.text === 'string' ? result.text : '';

    if (text && !isHallucination(text)) {
      return { text, provider: 'cloudflare' };
    }
  } catch (e) {
    logger.error('[cloudflare] Transcription error', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

// ─── Translation (@cf/meta/llama-3-8b-instruct) ──────────────────

export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  _signal: AbortSignal,
): Promise<TranslateResult | null> {
  try {
    const result = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: buildTranslatePrompt(targetLang, sourceLang) },
        { role: 'user', content: text },
      ],
    });

    const response =
      typeof result?.response === 'string' ? result.response : '';
    if (response) {
      return { translation: response, provider: 'cloudflare' };
    }
  } catch (e) {
    logger.error('[cloudflare] Translation error', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

export { ALL_LANGUAGES as supportedLanguages } from '../languages';
