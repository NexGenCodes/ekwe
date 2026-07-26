import { Env, TranslateResult } from '../types';
import { rotateKeys } from '../utils/keys';
import { buildTranslatePrompt } from '../utils/prompts';
import { fetchWithTimeout, getClientHeaders, TIMEOUT_FAST } from '../utils/fetch';
import { logger } from '../logger';

const MISTRAL_CHAT = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Mistral Small — Experiment Tier. Free forever, but 1 req/sec limit.
 * Multi-key rotation to bypass tight rate limits and multiply capacity.
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
    'MISTRAL_KEY_',
    (key) =>
      fetchWithTimeout(
        MISTRAL_CHAT,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...getClientHeaders(),
          },
          body: JSON.stringify({
            model: 'mistral-small-2603',
            messages: [
              { role: 'system', content: buildTranslatePrompt(targetLang, sourceLang) },
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
    const errText = await res?.text().catch(() => 'Unreadable error body');
    logger.error('[mistral] Translate HTTP error', {
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

  return { translation: content, provider: 'mistral' };
}

export { ALL_LANGUAGES as supportedLanguages } from '../languages';
