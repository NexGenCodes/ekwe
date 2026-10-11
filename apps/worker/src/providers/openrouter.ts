import { CLIENT_ABORTED, Env, TttRequest, TranslateResult } from "@/core/types";
import { rotateKeysDetailed } from "@/utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import { getUserAgent, fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { logger } from "@/core/logger";

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_REFFERER = "https://ekwe.pages.dev";

export async function ttt(
  text: string,
  request: TttRequest,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  logger.info("[openrouter] Requesting translation", {
    targetLang: request.targetLang,
    sourceLang: request.sourceLang,
  });

  try {
    const { response: res } = await rotateKeysDetailed(
      env,
      "OPENROUTER_KEY_",
      (key) =>
        fetchWithTimeout(
          OPENROUTER_CHAT,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              "User-Agent": getUserAgent(),
              "HTTP-Referer": OPENROUTER_REFFERER,
              "X-Title": "Ekwe",
            },
            body: JSON.stringify({
              model: "openrouter/free",
              messages: [
                {
                  role: "system",
                  content: buildTranslatePrompt(
                    request.targetLang,
                    request.sourceLang,
                    request.transliteration,
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
      logger.warn("[openrouter] Translate failed, provider returned error", {
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
      request.transliteration,
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
