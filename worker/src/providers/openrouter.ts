import { Env, TranslateResult } from '../types';
import { sanitizeKey, getUserAgent, fetchWithTimeout, TIMEOUT_FAST } from '../utils';

const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter — free-tier translation fallback. Single key.
 */
export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  const apiKey = sanitizeKey(env.OPENROUTER_KEY);
  if (apiKey.length <= 5) return null;

  const res = await fetchWithTimeout(
    OPENROUTER_CHAT,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ekwe.app',
        'X-Title': 'Ekwe',
        'User-Agent': getUserAgent(),
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [
          { role: 'system', content: buildPrompt(targetLang, sourceLang) },
          { role: 'user', content: text },
        ],
        temperature: 0,
      }),
    },
    TIMEOUT_FAST,
    signal,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unreadable error body');
    console.error(`[openrouter] HTTP ${res.status} error:`, errText);
    return null;
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  return { translation: content, provider: 'openrouter-free' };
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
