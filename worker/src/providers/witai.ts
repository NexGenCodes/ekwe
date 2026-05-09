import { Env, TranscribeResult } from '../types';
import { sanitizeKey, isHallucination, getUserAgent, fetchWithTimeout, TIMEOUT_SLOW } from '../utils';

const WITAI_DICTATION = 'https://api.wit.ai/dictation';

/**
 * Wit.ai Dictation API — zero cost, language-locked per API key.
 * Each WIT_KEY_{LANG} in env maps to one language.
 * Does NOT support auto-detection.
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const targetLang = lang.toUpperCase().replace('-', '_');
  const baseLang = targetLang.split('_')[0];
  const witKey = sanitizeKey(env[`WIT_KEY_${targetLang}`] ?? env[`WIT_KEY_${baseLang}`]);

  if (!witKey) return null;

  const res = await fetchWithTimeout(WITAI_DICTATION, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${witKey}`,
      'Content-Type': blob.type || 'audio/mpeg',
      'User-Agent': getUserAgent(),
    },
    body: blob,
  }, TIMEOUT_SLOW, signal);

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unreadable error body');
    console.error(`[witai] HTTP ${res.status} error:`, errText);
    return null;
  }

  const data = await parseStream(res);
  if (data?.text && !isHallucination(data.text)) {
    return { text: data.text, provider: `witai-${lang}` };
  }

  return null;
}

/**
 * Wit.ai returns a chunked stream of JSON objects.
 * We extract the last `text` field from the stream.
 */
async function parseStream(res: Response): Promise<{ text: string } | null> {
  let raw = await res.text();

  // Strip BOM characters that Wit.ai occasionally prepends
  raw = raw.replace(/^\uFEFF/, '');

  const jsonMatches = raw.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g);
  if (!jsonMatches) {
    console.warn('[witai] No JSON objects found in stream response');
    return null;
  }

  let finalTranscript = '';
  for (const part of jsonMatches) {
    try {
      const data = JSON.parse(part) as { text?: string; error?: string; is_final?: boolean };
      if (data.text) {
        finalTranscript = data.text;
        if (data.is_final) break;
      }
      if (data.error) console.error('[witai] Stream Error Chunk:', data.error);
    } catch {
      console.error('[witai] Malformed chunk:', part.substring(0, 50));
    }
  }

  return finalTranscript ? { text: finalTranscript } : null;
}

export const supportsAutoLang = false;
