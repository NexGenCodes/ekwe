import { Env, TranslateResult } from '../types';
import { rotateKeys } from '../utils/keys';
import { buildTranslatePrompt } from '../utils/prompts';
import { fetchWithTimeout, getClientHeaders, TIMEOUT_FAST } from '../utils/fetch';
import { logger } from '../logger';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

/**
 * Google Gemini 2.5 Flash — Multi-key rotation support.
 * Best-in-class multilingual translation.
 */
export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  logger.info('[gemini] Requesting translation', { targetLang, sourceLang });

  try {
    const res = await rotateKeys(
      env,
      'GEMINI_KEY_',
      (key) =>
        fetchWithTimeout(
          `${GEMINI_URL}?key=${key}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getClientHeaders(),
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: buildTranslatePrompt(targetLang, sourceLang) }],
              },
              contents: [
                { role: 'user', parts: [{ text }] },
              ],
              generationConfig: { temperature: 0.1 },
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
      logger.error('[gemini] Translate HTTP error', {
        status: res?.status,
        body: errText,
      });
      return null;
    }

    const data = (await res.json()) as GeminiResponse;
    const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!translation) {
      logger.warn('[gemini] Empty translation returned');
      return null;
    }

    return { translation, provider: 'gemini' };
  } catch (e) {
    logger.error('[gemini] Translate exception', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export { ALL_LANGUAGES as supportedLanguages } from '../languages';
