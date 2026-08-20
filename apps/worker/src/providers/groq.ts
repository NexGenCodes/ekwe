import { CLIENT_ABORTED, Env, TranscribeResult, TranslateResult } from "../core/types";
import { rotateKeysDetailed } from "../utils/keys";
import {
  isHallucination,
  buildTranslatePrompt,
  parseTranslateOutput,
} from "../utils/prompts";
import { mimeToExt } from "../utils/mime";
import {
  getUserAgent,
  fetchWithTimeout,
  TIMEOUT_FAST,
} from "../utils/fetch";
import { logger } from "../core/logger";
import { toWhisperCode } from "../services/languages";

const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";

// ─── Transcription (Whisper Large V3) ─────────────────────────────

export async function transcribe(
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
      if (lang && lang !== "auto") body.append("language", toWhisperCode(lang));
      body.append("response_format", "json");
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

  if (data.text && !isHallucination(data.text, durationMs)) {
    logger.info("[groq] Transcription success", {
      length: data.text.length,
      lang: data.language,
    });
    return {
      text: data.text,
      provider: "groq",
      duration: data.duration,
      language: data.language,
    };
  }

  logger.warn("[groq] Transcription empty or hallucinated", {
    text: data.text,
  });
  return null;
}

// ─── Translation (OpenAI GPT-OSS 120B) ──────────────────────────

export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
  transliteration: boolean = false,
): Promise<TranslateResult | null> {
  logger.info("[groq] Requesting translation", { targetLang, sourceLang });

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
      transliteration,
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

export { ALL_LANGUAGES as supportedLanguages } from "../services/languages";
