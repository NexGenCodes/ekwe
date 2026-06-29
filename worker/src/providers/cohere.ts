import { Env, TranscribeResult, TranslateResult } from '../types';
import { rotateKeys } from '../utils/keys';
import { buildTranslatePrompt } from '../utils/hallucination';
import { fetchWithTimeout, getClientHeaders, TIMEOUT_FAST } from '../utils/fetch';
import { mimeToExt } from '../utils/mime';
import { logger } from '../logger';
import { COHERE_LANGUAGES } from '../languages';

const COHERE_CHAT = 'https://api.cohere.ai/v2/chat';
const COHERE_TRANSCRIBE = 'https://api.cohere.com/v2/audio/transcriptions';
const COHERE_MODEL = 'cohere-transcribe-03-2026';

export const supportedLanguages = COHERE_LANGUAGES;

/**
 * Cohere Command-R — trial key, 1000 calls/mo per key.
 * Excellent multilingual model. Multi-key rotation to multiply capacity.
 */
export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  const res = await rotateKeys(
    env,
    'COHERE_KEY_',
    (key) =>
      fetchWithTimeout(
        COHERE_CHAT,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...getClientHeaders(),
          },
          body: JSON.stringify({
            model: 'command-r7b-12-2024',
            messages: [
              { role: 'system', content: buildPrompt(targetLang, sourceLang) },
              { role: 'user', content: text },
            ],
            temperature: 0.1,
          }),
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    const errText = await res?.text().catch(() => 'No response');
    logger.error('[cohere] Translate HTTP error', {
      status: res?.status,
      error: errText,
    });
    return null;
  }

  const data = (await res.json()) as {
    message?: { content?: Array<{ text?: string }> };
  };
  const translation = data.message?.content?.[0]?.text?.trim();
  if (!translation) return null;

  return { translation, provider: 'cohere-command-r-plus' };
}

export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  if (lang && lang !== 'auto' && !COHERE_LANGUAGES.has(lang)) {
    logger.info(`[cohere] Skipping transcribe — unsupported language: ${lang}`);
    return null;
  }

  const body = new FormData();
  body.append('model', COHERE_MODEL);
  body.append('language', lang === 'auto' ? 'en' : lang);
  body.append('file', blob, `audio.${mimeToExt(blob.type)}`);

  const res = await rotateKeys(
    env,
    'COHERE_KEY_',
    (key) =>
      fetchWithTimeout(
        COHERE_TRANSCRIBE,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body,
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    const errText = await res?.text().catch(() => 'No response');
    logger.error('[cohere] Transcribe HTTP error', {
      status: res?.status,
      error: errText,
    });
    return null;
  }

  const data = (await res.json()) as { text?: string };
  const text = data.text?.trim();
  if (!text) return null;

  return { text, provider: 'cohere-transcribe', language: lang !== 'auto' ? lang : undefined };
}

const buildPrompt = buildTranslatePrompt;
