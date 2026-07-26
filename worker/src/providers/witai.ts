import { logger } from '../logger';
import { Env, TranscribeResult } from '../types';
import { sanitizeKey } from '../utils/keys';
import { isHallucination } from '../utils/prompts';
import { getUserAgent, fetchWithTimeout, TIMEOUT_SLOW } from '../utils/fetch';
import { decodeOpusFrame, isOpusDecoderReady } from '../utils/opus';
import { pcmToWav } from '../utils/wav';
import { mergePcmFrames } from '../utils/pcm';

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
    return null;
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
    return { text: data.text, provider: 'witai', language: lang };
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
 * Parses Wit.ai's newline-delimited JSON stream response.
 * Splits on \r\n and builds partial chunks until valid JSON forms.
 */
async function parseStream(res: Response): Promise<{ text: string } | null> {
  const raw = await res.text();
  return parseJsonStream(raw);
}

/**
 * Handles a real-time streaming session via Wit.ai HTTP dictation.
 * Pipes client WebSocket audio → ReadableStream → Wit.ai HTTP,
 * then streams incremental transcripts back to the client.
 * Returns true if the session was handled, false if the provider could not connect.
 */
export async function handleStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const targetLang = lang.toUpperCase().replace('-', '_');
  const baseLang = targetLang.split('_')[0];
  const witKey = sanitizeKey(
    env[`WIT_KEY_${targetLang}`] ?? env[`WIT_KEY_${baseLang}`],
  );
  if (!witKey) return false;

  logger.info('[witai:stream] Starting dictation session', { lang });

  // Buffer for accumulating decoded PCM frames for WAV wrapping
  let pcmFrames: Int16Array[] = [];
  let lastFlush = Date.now();

  const audioStream = new ReadableStream({
    start(controller) {
      const flushPcm = (): void => {
        if (pcmFrames.length === 0) return;
        const merged = mergePcmFrames(pcmFrames);
        pcmFrames = [];
        const wav = pcmToWav(merged, 16000);
        controller.enqueue(wav);
      };

      const onMessage = async (event: MessageEvent): Promise<void> => {
        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          let data: Uint8Array;
          if (event.data instanceof ArrayBuffer) {
            data = new Uint8Array(event.data);
          } else {
            data = new Uint8Array(await event.data.arrayBuffer());
          }

          if (isOpusDecoderReady()) {
            const pcm = decodeOpusFrame(data, 16000);
            if (pcm) {
              pcmFrames.push(pcm);
              // Flush periodically (every 500ms) to send WAV chunks
              const now = Date.now();
              if (now - lastFlush > 500 || pcmFrames.length >= 25) {
                flushPcm();
                lastFlush = now;
              }
            }
          } else {
            // Fallback: forward raw data
            controller.enqueue(data);
          }
        }
      };

      const onClose = (): void => {
        flushPcm();
        try { controller.close(); } catch { /* already closed */ }
      };

      clientWs.addEventListener('message', onMessage);
      clientWs.addEventListener('close', onClose);

      signal.addEventListener('abort', () => {
        flushPcm();
        clientWs.removeEventListener('message', onMessage);
        clientWs.removeEventListener('close', onClose);
        try { controller.close(); } catch { /* ignore */ }
      });
    },
  });

  try {
    const res = await fetchWithTimeout(
      WITAI_DICTATION,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${witKey}`,
          'Content-Type': 'audio/wav',
        },
        body: audioStream,
        duplex: 'half',
      } as RequestInit & { duplex: string },
      TIMEOUT_SLOW,
      signal,
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error('[witai:stream] HTTP error', { status: res.status, body: errText });
      return false;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      logger.error('[witai:stream] No response body');
      return false;
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.replace(/\r$/, '').trim();
        if (!trimmed) continue;

        try {
          const data = JSON.parse(trimmed) as {
            text?: string;
            type?: string;
            is_final?: boolean;
            error?: string;
          };

          if (data.error) {
            logger.error('[witai:stream] Error in stream', { error: data.error });
            continue;
          }

          if (data.text && !isHallucination(data.text)) {
            const isFinal = data.type === 'final' || data.is_final === true;
            clientWs.send(JSON.stringify({
              type: isFinal ? 'final' : 'interim',
              text: data.text,
              provider: 'witai',
            }));
          }
        } catch { /* incomplete JSON, wait for more data */ }
      }
    }

    return true;
  } catch (err) {
    logger.error('[witai:stream] Request failed', { error: String(err) });
    return false;
  }
}

/**
 * Shared JSON stream parser — splits on \r\n, builds partial chunks,
 * returns the last successfully parsed object (which is the final transcript).
 */
function parseJsonStream(raw: string): { text: string } | null {
  const cleaned = raw.replace(/^\uFEFF/, '');
  logger.info('[witai] Raw response', {
    length: cleaned.length,
    snippet: cleaned.substring(0, 500),
  });

  if (!cleaned.trim()) {
    logger.warn('[witai] Empty response body');
    return null;
  }

  const parts = cleaned.split('\n');
  let last: { text?: string } | null = null;
  let prev = '';

  for (const chunk of parts) {
    const trimmed = chunk.replace(/\r$/, '').trim();
    if (!trimmed) continue;

    try {
      prev += trimmed;
      last = JSON.parse(prev) as { text?: string };
      prev = '';
    } catch { /* incomplete, keep building */ }
  }

  if (!last?.text?.trim()) return null;

  logger.info('[witai] Final transcript', { text: last.text.substring(0, 100) });
  return { text: last.text.trim() };
}

/**
 * Wit.ai supported MIME types + common aliases.
 * Returns null for types Wit.ai will reject — lets the orchestrator skip silently.
 */
function toWitMime(mime: string): string | null {
  const baseMime = mime.split(';')[0].trim().toLowerCase();
  const map: Record<string, string | null> = {
    'audio/mpeg': 'audio/mpeg3',
    'audio/mp3': 'audio/mpeg3',
    'audio/mpeg3': 'audio/mpeg3',
    'audio/mp4': null,
    'audio/m4a': null,
    'audio/x-m4a': null,
    'audio/aac': null,
    'audio/wav': 'audio/wav',
    'audio/x-wav': 'audio/wav',
    'audio/ogg': 'audio/ogg',
    'audio/opus': 'audio/ogg',
    'audio/webm': 'audio/webm',
    'audio/ulaw': 'audio/ulaw',
    'audio/raw': 'audio/raw',
  };
  return map[baseMime] ?? null;
}

export { WITAI_LANGUAGES as supportedLanguages } from '../languages';
