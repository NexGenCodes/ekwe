import { CLIENT_ABORTED, Env, TranslateResult, TtsAttempt } from "../core/types";
import { rotateKeys, rotateKeysDetailed } from "../utils/keys";
import {
  buildTranslatePrompt,
  parseTranslateOutput,
} from "../utils/prompts";
import { base64ToBytes } from "../utils/base64";
import { pcmToWav } from "../utils/wav";
import {
  fetchWithTimeout,
  getClientHeaders,
  logProviderError,
  TIMEOUT_FAST,
} from "../utils/fetch";
import { logger } from "../core/logger";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

// Gemini's preview TTS model emits 24kHz mono 16-bit little-endian PCM inline.
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;

/** Hard ceiling on decoded provider output (~170s of 24kHz WAV). */
const MAX_TTS_BYTES = 8 * 1024 * 1024;

/**
 * Google Gemini 2.5 Flash — Multi-key rotation support.
 * Best-in-class multilingual translation.
 */
export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
  transliteration: boolean = false,
): Promise<TranslateResult | null> {
  logger.info("[gemini] Requesting translation", { targetLang, sourceLang });

  try {
    const res = await rotateKeys(
      env,
      "GEMINI_KEY_",
      (key) =>
        fetchWithTimeout(
          GEMINI_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Key in the header, never the URL: query-string keys leak into
              // access logs, referrers, and middlebox telemetry.
              "x-goog-api-key": key,
              ...getClientHeaders(),
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [
                  {
                    text: buildTranslatePrompt(
                      targetLang,
                      sourceLang,
                      transliteration,
                    ),
                  },
                ],
              },
              contents: [{ role: "user", parts: [{ text }] }],
              generationConfig: { temperature: 0.1 },
            }),
          },
          TIMEOUT_FAST,
          signal,
        ),
      signal,
    );

    if (!res?.ok) {
      await logProviderError("gemini translate", res);
      return null;
    }

    const data = await res.json<GeminiResponse>();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) {
      logger.warn("[gemini] Empty translation returned");
      return null;
    }

    const { translation, transliteration: romanized } = parseTranslateOutput(
      raw,
      transliteration,
    );
    return {
      translation,
      ...(romanized ? { transliteration: romanized } : {}),
      provider: "gemini",
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[gemini] Translate exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

// ─── Text-to-Speech (gemini-2.5-flash-preview-tts) ────────────────

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
    };
  }>;
}

// The TTS-only model refuses transcripts that don't look like speech
// instructions ("Model tried to generate text, but it should only be used for
// TTS"). Prefix the transcript so the model speaks it instead of rejecting the
// request. (TTS models also break on system instructions, so none are sent.)
const GEMINI_TTS_PROMPT = "Say the following:";

// The TTS preview model occasionally 500s on otherwise-valid requests (Google
// documents this and recommends client retry). `rotateKeysDetailed` already
// fast-fails on 5xx after a single key, so a retry costs exactly one request;
// keep it bounded and delay-free to stay inside the route's per-provider time
// budget without introducing abort-safety issues.
const GEMINI_TTS_MAX_ATTEMPTS = 3;

/**
 * Gemini TTS → 24kHz WAV. Restricted `GEMINI_KEY_*` keys are required; key
 * rotation is handled by `rotateKeysDetailed`, and 429/403 surfaces to the
 * `/tts` route as a "provider exhausted for the day" signal. Transient 5xx
 * responses are retried up to {@link GEMINI_TTS_MAX_ATTEMPTS} times.
 */
export async function tts(
  text: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
): Promise<TtsAttempt> {
  const voiceName = voice ?? env.TTS_GEMINI_VOICE ?? "Kore";
  try {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);

    let response: Response | null = null;
    let lastStatus: number | null = null;

    for (let attempt = 1; attempt <= GEMINI_TTS_MAX_ATTEMPTS; attempt++) {
      const rotation = await rotateKeysDetailed(
        env,
        "GEMINI_KEY_",
        (key) =>
          fetchWithTimeout(
            GEMINI_TTS_URL,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                // Key in the header, never the URL (see `translate` above).
                "x-goog-api-key": key,
                ...getClientHeaders(),
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [{ text: `${GEMINI_TTS_PROMPT} ${text}` }],
                  },
                ],
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName },
                    },
                  },
                },
              }),
            },
            TIMEOUT_FAST,
            signal,
          ),
        signal,
      );

      response = rotation.response;
      lastStatus = rotation.lastStatus;

      // Success (`response` is set only on 2xx) or a terminal failure — retry
      // only the transient 5xx class.
      if (response || (lastStatus ?? 0) < 500) break;
    }

    if (!response) {
      return { result: null, status: lastStatus };
    }

    const data = await response.json<GeminiTtsResponse>();
    const inlineData = data.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    )?.inlineData;

    if (!inlineData?.data || !inlineData.mimeType?.includes("audio/L16")) {
      logger.warn("[gemini] TTS: no L16 PCM audio in response");
      return { result: null, status: 502 };
    }

    const pcmBytes = base64ToBytes(inlineData.data);
    if (pcmBytes.byteLength === 0 || pcmBytes.byteLength % 2 !== 0) {
      logger.warn("[gemini] TTS: invalid PCM length", {
        bytes: pcmBytes.byteLength,
      });
      return { result: null, status: 502 };
    }
    if (pcmBytes.byteLength > MAX_TTS_BYTES) {
      logger.warn("[gemini] TTS: PCM output over hard cap", {
        bytes: pcmBytes.byteLength,
      });
      return { result: null, status: 502 };
    }

    const pcm = new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      pcmBytes.byteLength / 2,
    );
    return {
      result: {
        audio: pcmToWav(pcm, 24000),
        mime: "audio/wav",
        provider: "gemini",
      },
      status: null,
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[gemini] TTS exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { result: null, status: null };
  }
}

export { ALL_LANGUAGES as supportedLanguages } from "../services/languages";
