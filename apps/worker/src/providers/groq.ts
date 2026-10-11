import {
  CLIENT_ABORTED,
  Env,
  TttRequest,
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

const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  logger.info("[groq] Requesting transcription", { lang, size: blob.size });

  const { response: res } = await rotateKeysDetailed(
    env,
    "GROQ_KEY_",
    (key) => {
      const body = new FormData();
      body.append("file", blob, `audio.${mimeToExt(blob.type)}`);
      body.append("model", "whisper-large-v3");

      const isAuto = !lang || lang === "auto";
      if (!isAuto) {
        body.append("language", toProviderCode("groq", "stt", lang));
        body.append("response_format", "json");
      } else {
        // Groq's plain `json` format returns only `text`; `language` and
        // `duration` come back exclusively with `verbose_json`. The auto path
        // needs the detected language to report it, so it must ask for the
        // verbose shape. This mirrors the OpenRouter provider.
        body.append("response_format", "verbose_json");
      }
      body.append("temperature", "0");

      return fetchWithTimeout(
        GROQ_TRANSCRIBE,
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
    logger.warn("[groq] Transcribe failed, provider returned error", {
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
  // `verbose_json` spells the language out in English ("French"), so it has to
  // be folded back to a canonical code before anything compares it against
  // franc. Left unresolved when it names something we do not carry.
  const detected = canonicalLanguageFromName(data.language);

  if (data.text && !isHallucination(data.text, durationMs)) {
    logger.info("[groq] Transcription success", {
      length: data.text.length,
      lang: detected,
    });
    return {
      text: data.text,
      provider: "groq",
      ...(data.duration ? { duration: data.duration } : {}),
      // Absent when unresolved — never substitute a default language.
      ...(detected ? { language: detected } : {}),
    };
  }

  logger.warn("[groq] Transcription empty or hallucinated", {
    text: data.text,
  });
  return null;
}

export async function ttt(
  text: string,
  request: TttRequest,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  logger.info("[groq] Requesting translation", {
    targetLang: request.targetLang,
    sourceLang: request.sourceLang,
  });

  try {
    const { response: res, lastStatus } = await rotateKeysDetailed(
      env,
      "GROQ_KEY_",
      (key) =>
        fetchWithTimeout(
          GROQ_CHAT,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              "User-Agent": getUserAgent(),
            },
            body: JSON.stringify({
              model: "openai/gpt-oss-120b",
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
      logger.warn("[groq] Translate failed, provider returned error", {
        status: res?.status ?? "no response",
        lastStatus,
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
      provider: "groq",
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[groq] Translate exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
