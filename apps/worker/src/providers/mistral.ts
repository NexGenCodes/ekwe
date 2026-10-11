import { CLIENT_ABORTED, Env, TttRequest, TranslateResult } from "@/core/types";
import { rotateKeys } from "@/utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import {
  fetchWithTimeout,
  getClientHeaders,
  TIMEOUT_FAST,
} from "@/utils/fetch";
import { logger } from "@/core/logger";

const MISTRAL_CHAT = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "ministral-14b-latest";

export async function ttt(
  text: string,
  request: TttRequest,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  logger.info("[mistral] Requesting translation", {
    targetLang: request.targetLang,
    sourceLang: request.sourceLang,
  });

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
              model: MISTRAL_MODEL,
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
      request.transliteration,
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
