import {
  CLIENT_ABORTED,
  Env,
  TttRequest,
  TranscribeResult,
  TranslateResult,
} from "@/core/types";
import { rotateKeys } from "@/utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import {
  fetchWithTimeout,
  getClientHeaders,
  TIMEOUT_FAST,
} from "@/utils/fetch";
import { mimeToExt } from "@/utils/mime";
import { logger } from "@/core/logger";
import { isLanguageSupported } from "@ekwe/shared/languageCapabilities";

const COHERE_CHAT = "https://api.cohere.ai/v2/chat";
const COHERE_TRANSCRIBE = "https://api.cohere.com/v2/audio/transcriptions";
const COHERE_MODEL = "cohere-transcribe-03-2026";

export async function ttt(
  text: string,
  request: TttRequest,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  logger.info("[cohere] Requesting translation", {
    targetLang: request.targetLang,
    sourceLang: request.sourceLang,
  });

  try {
    const res = await rotateKeys(
      env,
      "COHERE_KEY_",
      (key) =>
        fetchWithTimeout(
          COHERE_CHAT,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              ...getClientHeaders(),
            },
            body: JSON.stringify({
              model: "command-r7b-12-2024",
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
              temperature: 0.1,
            }),
          },
          TIMEOUT_FAST,
          signal,
        ),
      signal,
    );

    if (!res?.ok) {
      logger.warn("[cohere] Translate failed, provider returned error", {
        status: res?.status ?? "no response",
      });
      return null;
    }

    const data = await res.json<{
      message?: { content?: Array<{ text?: string }> };
    }>();
    const raw = data.message?.content?.[0]?.text?.trim();
    if (!raw) return null;

    const { translation, transliteration: romanized } = parseTranslateOutput(
      raw,
      request.transliteration,
    );
    return {
      translation,
      ...(romanized ? { transliteration: romanized } : {}),
      provider: "cohere",
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[cohere] Translate exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  if (lang && lang !== "auto" && !isLanguageSupported("cohere", "stt", lang)) {
    logger.info(`[cohere] Skipping transcribe — unsupported language: ${lang}`);
    return null;
  }

  const body = new FormData();
  body.append("model", COHERE_MODEL);
  body.append("language", lang === "auto" ? "en" : lang);
  body.append("file", blob, `audio.${mimeToExt(blob.type)}`);

  const res = await rotateKeys(
    env,
    "COHERE_KEY_",
    (key) =>
      fetchWithTimeout(
        COHERE_TRANSCRIBE,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body,
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    logger.warn("[cohere] Transcribe failed, provider returned error", {
      status: res?.status ?? "no response",
    });
    return null;
  }

  const data = await res.json<{ text?: string }>();
  const text = data.text?.trim();
  if (!text) return null;

  return {
    text,
    provider: "cohere",
    language: lang !== "auto" ? lang : undefined,
  };
}
