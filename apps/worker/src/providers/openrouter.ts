import { CLIENT_ABORTED, Env, TranslateResult } from "../core/types";
import { sanitizeKey } from "../utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "../utils/prompts";
import {
  getUserAgent,
  fetchWithTimeout,
  TIMEOUT_FAST,
} from "../utils/fetch";
import { logger } from "../core/logger";

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenRouter — free-tier translation fallback. Single key.
 */
export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
  transliteration: boolean = false,
): Promise<TranslateResult | null> {
  logger.info("[openrouter] Requesting translation", {
    targetLang,
    sourceLang,
  });
  const apiKey = sanitizeKey(env.OPENROUTER_KEY);
  if (apiKey.length <= 5) {
    logger.warn("[openrouter] Skipping: API key missing");
    return null;
  }

  try {
    const res = await fetchWithTimeout(
      OPENROUTER_CHAT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ekwe.app",
          "X-Title": "Ekwe",
          "User-Agent": getUserAgent(),
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            {
              role: "system",
              content: buildTranslatePrompt(targetLang, sourceLang, transliteration),
            },
            { role: "user", content: text },
          ],
          temperature: 0,
        }),
      },
      TIMEOUT_FAST,
      signal,
    );

    if (!res.ok) {
      logger.warn("[openrouter] Translate failed, provider returned error", {
        status: res.status,
      });
      return null;
    }

    const data = await res.json<{
      choices?: Array<{ message?: { content?: string } }>;
    }>();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const { translation, transliteration: romanized } = parseTranslateOutput(
      content,
      transliteration,
    );
    return {
      translation,
      ...(romanized ? { transliteration: romanized } : {}),
      provider: "openrouter",
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[openrouter] Translate exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
