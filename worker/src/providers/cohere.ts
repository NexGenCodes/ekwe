import { Env, TranslateResult } from '../types';
import {
  rotateKeys,
  fetchWithTimeout,
  getClientHeaders,
  TIMEOUT_FAST,
} from '../utils';
import { logger } from '../logger';

const COHERE_CHAT = 'https://api.cohere.ai/v2/chat';

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

function buildPrompt(targetLang: string, sourceLang?: string): string {
  return `You are an expert, highly accurate professional translator.
Your sole task is to translate the user's text${sourceLang ? ` from ${sourceLang}` : ''} into fluent, natural-sounding ${targetLang}.
Rules:
1. Preserve the original tone, context, and formatting exactly.
2. Do not add any explanations, conversational text, notes, or preambles.
3. If the text is already in the target language, return it unchanged.
4. Output ONLY the final translated text and nothing else.`;
}
