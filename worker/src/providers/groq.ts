import { Env, TranscribeResult, TranslateResult } from '../types';
import { rotateKeys } from '../utils/keys';
import { isHallucination, buildTranslatePrompt } from '../utils/hallucination';
import { mimeToExt } from '../utils/mime';
import { getUserAgent, fetchWithTimeout, TIMEOUT_FAST } from '../utils/fetch';
import { logger } from '../logger';

const GROQ_TRANSCRIBE = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Transcription (Whisper Large V3) ─────────────────────────────

export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  logger.info('[groq] Requesting transcription', { lang, size: blob.size });

  const res = await rotateKeys(
    env,
    'GROQ_KEY_',
    (key) => {
      const body = new FormData();
      body.append('file', blob, `audio.${mimeToExt(blob.type)}`);
      body.append('model', 'whisper-large-v3');
      if (lang && lang !== 'auto') body.append('language', lang);
      body.append('response_format', 'json');
      body.append('temperature', '0');

      return fetchWithTimeout(
        GROQ_TRANSCRIBE,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body,
        },
        TIMEOUT_FAST,
        signal,
      );
    },
    signal,
  );

  if (!res?.ok) {
    const errText =
      (await res?.text().catch(() => 'No body')) || 'Unknown fetch error';
    logger.error('[groq] Transcribe HTTP error', {
      status: res?.status,
      body: errText,
    });
    return null;
  }

  const data = (await res.json()) as {
    text?: string;
    duration?: number;
    language?: string;
  };
  const durationMs = data.duration ? data.duration * 1000 : undefined;

  if (data.text && !isHallucination(data.text, durationMs)) {
    logger.info('[groq] Transcription success', {
      length: data.text.length,
      lang: data.language,
    });
    return {
      text: data.text,
      provider: 'groq',
      duration: data.duration,
      language: data.language,
    };
  }

  logger.warn('[groq] Transcription empty or hallucinated', {
    text: data.text,
  });
  return null;
}

// ─── Translation (LLaMA 3.3 70B) ─────────────────────────────────

export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  logger.info('[groq] Requesting translation', { targetLang, sourceLang });

  const res = await rotateKeys(
    env,
    'GROQ_KEY_',
    (key) =>
      fetchWithTimeout(
        GROQ_CHAT,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'User-Agent': getUserAgent(),
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: buildPrompt(targetLang, sourceLang) },
              { role: 'user', content: text },
            ],
            temperature: 0,
          }),
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    const errText =
      (await res?.text().catch(() => 'No body')) || 'Unknown fetch error';
    logger.error('[groq] Translate HTTP error', {
      status: res?.status,
      body: errText,
    });
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  return { translation: content, provider: 'groq-llama-3.3-70b' };
}

const buildPrompt = buildTranslatePrompt;
export { ALL_LANGUAGES as supportedLanguages } from '../languages';
