import { CLIENT_ABORTED, Env, TranslateResult } from "../core/types";
import { rotateKeys } from "../utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "../utils/prompts";
import {
  fetchWithTimeout,
  getClientHeaders,
  TIMEOUT_FAST,
} from "../utils/fetch";
import { logger } from "../core/logger";

const MISTRAL_CHAT = "https://api.mistral.ai/v1/chat/completions";

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
  transliteration: boolean = false,
): Promise<TranslateResult | null> {
  logger.info("[mistral] Requesting translation", { targetLang, sourceLang });

  try {
    const res = await rotateKeys(
      env,
      "MISTRAL_KEY_",
      (key) =>
        fetchWithTimeout(
          MISTRAL_CHAT,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              ...getClientHeaders(),
            },
            body: JSON.stringify({
              model: "mistral-small-2603",
              messages: [
                {
                  role: "system",
                  content: buildTranslatePrompt(
                    targetLang,
                    sourceLang,
                    transliteration,
                  ),
                },
                { role: "user", content: text },
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
      logger.warn("[mistral] Translate failed, provider returned error", {
        status: res?.status ?? "no response",
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
      provider: "mistral",
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[mistral] Translate exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
