import { Env, TranslateResult } from '../types';
import { rotateKeys, fetchWithTimeout, getClientHeaders, TIMEOUT_FAST } from '../utils';
import { logger } from '../logger';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/**
 * Google Gemini 1.5 Flash — Multi-key rotation support.
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
      (key) => fetchWithTimeout(
        `${GEMINI_URL}?key=${key}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getClientHeaders(),
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: buildPrompt(text, targetLang, sourceLang) }],
            }],
            generationConfig: { temperature: 0.1 },
          }),
        },
        TIMEOUT_FAST,
        signal,
      ),
      signal,
    );

    if (!res?.ok) {
      const errText = await res?.text().catch(() => 'No body') || 'Unknown fetch error';
      logger.error('[gemini] Translate HTTP error', { status: res?.status, body: errText });
      return null;
    }

    const data = await res.json() as GeminiResponse;
    const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!translation) {
      logger.warn('[gemini] Empty translation returned');
      return null;
    }

    return { translation, provider: 'gemini-2.5-flash' };
  } catch (e) {
    logger.error('[gemini] Translate exception', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function buildPrompt(text: string, targetLang: string, sourceLang?: string): string {
  return `You are an expert, highly accurate professional translator.
Your sole task is to translate the user's text${sourceLang ? ` from ${sourceLang}` : ''} into fluent, natural-sounding ${targetLang}.
Rules:
1. Preserve the original tone, context, and formatting exactly.
2. Do not add any explanations, conversational text, notes, or preambles.
3. If the text is already in the target language, return it unchanged.
4. Output ONLY the final translated text and nothing else.

Text to translate:
${text}`;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}
