import { Env, TranslateResult } from '../types';
import { rotateKeys, getUserAgent, fetchWithTimeout, TIMEOUT_FAST } from '../utils';

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
    (key) => fetchWithTimeout(
      MISTRAL_CHAT,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'User-Agent': getUserAgent(),
          ...(env.EVASION_HEADERS || {}),
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
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
    const errText = await res?.text().catch(() => 'Unreadable error body');
    console.error(`[mistral] HTTP ${res?.status} error:`, errText);
    return null;
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  return { translation: content, provider: 'mistral-small' };
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
