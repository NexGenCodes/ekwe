import { Env, TranslateResult } from '../types';
import { sanitizeKey, fetchWithTimeout, TIMEOUT_FAST } from '../utils';
import { logger } from '../logger';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Google Gemini 2.0 Flash — single key, 1500 req/day free.
 * Best-in-class multilingual translation. No rotation needed.
 */
export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  const apiKey = sanitizeKey(env.GEMINI_KEY);
  if (apiKey.length <= 5) return null;

  try {
    const res = await fetchWithTimeout(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.EVASION_HEADERS || {}),
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
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unreadable');
      logger.error({ provider: 'gemini', status: res.status, error: errText });
      return null;
    }

    const data = await res.json() as GeminiResponse;
    const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!translation) return null;

    return { translation, provider: 'gemini-2.0-flash' };
  } catch (e) {
    logger.error({ provider: 'gemini', error: String(e) });
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
