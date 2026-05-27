import { logger } from '../logger';
import { Env, TranscribeResult } from '../types';
import {
  sanitizeKey,
  isHallucination,
  getUserAgent,
  fetchWithTimeout,
  TIMEOUT_SLOW,
} from '../utils';

const WITAI_DICTATION = 'https://api.wit.ai/dictation?v=20240304';

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
  const witKey = sanitizeKey(
    env[`WIT_KEY_${targetLang}`] ?? env[`WIT_KEY_${baseLang}`],
  );

  if (!witKey) {
    logger.warn('[witai] Skipping: No API key found', {
      lang,
      targetLang,
      baseLang,
    });
    return null;
  }

  const contentType = toWitMime(blob.type);
  if (!contentType) {
    logger.warn('[witai] Skipping: Unsupported MIME type', { type: blob.type });
    return null; // Unsupported MIME — skip
  }

  logger.info('[witai] Sending request', {
    lang,
    contentType,
    blobSize: blob.size,
    blobType: blob.type,
  });

  const res = await fetchWithTimeout(
    WITAI_DICTATION,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${witKey}`,
        'Content-Type': contentType,
        'User-Agent': getUserAgent(),
      },
      body: blob,
    },
    TIMEOUT_SLOW,
    signal,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unreadable error body');
    logger.error(`[witai] HTTP ${res.status} error`, {
      status: res.status,
      body: errText,
    });
    return null;
  }

  const data = await parseStream(res);
  if (data?.text && !isHallucination(data.text)) {
    return { text: data.text, provider: `witai-${lang}`, language: lang };
  }

  if (data?.text) {
    logger.warn('[witai] Transcript discarded as hallucination', {
      text: data.text.substring(0, 50),
    });
  } else {
    logger.warn('[witai] No transcript returned in stream response');
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

  // Always log the raw response for debugging (clamped to 500 chars)
  logger.info('[witai] Raw response', {
    length: raw.length,
    snippet: raw.substring(0, 500),
  });

  if (!raw.trim()) {
    logger.warn('[witai] Empty response body');
    return null;
  }

  // Wit.ai dictation often returns multiple JSON objects in one go or per line
  // We use a regex that handles nested braces if any, but usually it's flat.
  const jsonMatches = raw.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g);

  if (!jsonMatches || jsonMatches.length === 0) {
    logger.warn('[witai] No JSON objects found in response', {
      rawSnippet: raw.substring(0, 300),
    });
    return null;
  }

  logger.info('[witai] Parsing chunks', { count: jsonMatches.length });

  let finalTranscript = '';
  for (const part of jsonMatches) {
    try {
      const data = JSON.parse(part) as {
        text?: string;
        error?: string;
        is_final?: boolean;
      };
      if (data.text) {
        finalTranscript = data.text;
        // Don't break on is_final, because sometimes the final text is in the very last chunk
        // and we want the absolute latest.
      }
      if (data.error)
        logger.error('[witai] Stream Error Chunk', { error: data.error });
    } catch (e) {
      logger.error('[witai] Malformed chunk', {
        chunk: part.substring(0, 50),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return finalTranscript.trim() ? { text: finalTranscript.trim() } : null;
}

/**
 * Wit.ai supported MIME types + common aliases.
 * Returns null for types Wit.ai will reject — lets the orchestrator skip silently.
 */
function toWitMime(mime: string): string | null {
  const baseMime = mime.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'audio/mpeg': 'audio/mpeg3',
    'audio/mp3': 'audio/mpeg3',
    'audio/mpeg3': 'audio/mpeg3',
    'audio/mp4': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'audio/x-m4a': 'audio/mp4',
    'audio/aac': 'audio/mp4',
    'audio/wav': 'audio/wav',
    'audio/x-wav': 'audio/wav',
    'audio/ogg': 'audio/ogg',
    'audio/opus': 'audio/ogg',
    'audio/flac': 'audio/flac',
    'audio/x-flac': 'audio/flac',
    'audio/webm': 'audio/webm',
    'audio/ulaw': 'audio/ulaw',
    'audio/raw': 'audio/raw',
  };
  return map[baseMime] ?? null;
}

export const supportsAutoLang = false;
