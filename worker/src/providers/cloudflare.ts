import { Env, TranscribeResult, TranslateResult } from '../types';
import { isHallucination } from '../utils';

/**
 * Cloudflare Workers AI — zero-key safety net.
 * Uses AI binding directly, no API keys needed.
 */

// ─── Transcription (@cf/openai/whisper) ───────────────────────────

export async function transcribe(
  blob: Blob,
  _lang: string,
  env: Env,
  _signal: AbortSignal,
): Promise<TranscribeResult | null> {
  try {
    const audio = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const result = await env.AI.run('@cf/openai/whisper', { audio });
    const text = typeof result?.text === 'string' ? result.text : '';

    if (text && !isHallucination(text)) {
      return { text, provider: 'cloudflare' };
    }
  } catch (e) {
    console.error('[cloudflare] Transcription error:', e instanceof Error ? e.message : String(e));
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
        { role: 'system', content: buildPrompt(targetLang, sourceLang) },
        { role: 'user', content: text },
      ],
    });

    const response = typeof result?.response === 'string' ? result.response : '';
    if (response) {
      return { translation: response, provider: 'cloudflare-ai-llama3' };
    }
  } catch (e) {
    console.error('[cloudflare] Translation error:', e instanceof Error ? e.message : String(e));
  }

  return null;
}

function buildPrompt(targetLang: string, sourceLang?: string): string {
  return `You are an expert, highly accurate professional translator.
Your sole task is to translate the user's text${sourceLang ? ` from ${sourceLang}` : ''} into fluent, natural-sounding ${targetLang}.
Rules:
1. Preserve the original tone, context, and formatting exactly.
2. Do not add any explanations, conversational text, notes, or preambles.
3. If the text is already in the target language, return it unchanged.
4. Output ONLY the final translated text and nothing else.`;
}

export const supportsAutoLang = true;
