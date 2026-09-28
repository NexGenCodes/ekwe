import {
  CLIENT_ABORTED,
  Env,
  TranscribeResult,
  TranslateResult,
} from "@/core/types";
import { rotateKeysDetailed } from "@/utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import { isHallucination } from "@/utils/hallucination";
import { mimeToExt } from "@/utils/mime";
import { getUserAgent, fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { logger } from "@/core/logger";
import { toProviderCode } from "@ekwe/shared/languageCapabilities";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

const OPENROUTER_TRANSCRIBE =
  "https://openrouter.ai/api/v1/audio/transcriptions";
const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_REFFERER = "https://ekwe.pages.dev";

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  logger.info("[openrouter] Requesting transcription", {
    lang,
    size: blob.size,
  });

  const { response: res } = await rotateKeysDetailed(
    env,
    "OPENROUTER_KEY_",
    (key) => {
      const body = new FormData();
      body.append("file", blob, `audio.${mimeToExt(blob.type)}`);
      body.append("model", "openai/whisper-large-v3");

      const isAuto = !lang || lang === "auto";
      if (!isAuto) {
        body.append("language", toProviderCode("openrouter", "stt", lang));
        body.append("response_format", "json");
      } else {
        body.append("response_format", "verbose_json");
      }
      body.append("temperature", "0");

      return fetchWithTimeout(
        OPENROUTER_TRANSCRIBE,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body,
        },
        TIMEOUT_FAST,
        signal,
      );
    },
    signal,
  );

  if (!res?.ok) {
    logger.warn("[openrouter] Transcribe failed, provider returned error", {
      status: res?.status ?? "no response",
    });
    return null;
  }

  const data = await res.json<{
    text?: string;
    duration?: number;
    language?: string;
  }>();
  const durationMs = data.duration ? data.duration * 1000 : undefined;
  // Same `verbose_json` shape Groq serves, from the same Whisper model: the
  // detected language arrives as an English name and has to be folded back to a
  // canonical code before anything compares it against franc.
  const detected = canonicalLanguageFromName(data.language);

  if (data.text && !isHallucination(data.text, durationMs)) {
    logger.info("[openrouter] Transcription success", {
      length: data.text.length,
      lang: detected,
    });
    return {
      text: data.text,
      provider: "openrouter",
      duration: data.duration,
      // Absent when unresolved — never substitute a default language.
      ...(detected ? { language: detected } : {}),
    };
  }

  logger.warn("[openrouter] Transcription empty or hallucinated", {
    text: data.text,
  });
  return null;
}

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
