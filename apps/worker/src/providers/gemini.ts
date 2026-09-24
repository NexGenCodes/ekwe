import {
  CLIENT_ABORTED,
  Env,
  TranslateResult,
  SpeechAttempt,
} from "@/core/types";
import { rotateKeys, rotateKeysDetailed } from "@/utils/keys";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import { base64ToBytes } from "@/utils/base64";
import { pcmToWav } from "@/utils/wav";
import {
  fetchWithTimeout,
  getClientHeaders,
  TIMEOUT_FAST,
} from "@/utils/fetch";
import { logger } from "@/core/logger";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

const GEMINI_SPEECH_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_SPEECH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SPEECH_MODEL}:generateContent`;

const MAX_SPEECH_BYTES = 8 * 1024 * 1024;

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
      logger.warn("[gemini] Translate failed, provider returned error", {
        status: res?.status ?? "no response",
      });
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

interface GeminiSpeechResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
    };
  }>;
}

const GEMINI_SPEECH_PROMPT = "Say the following:";

const GEMINI_SPEECH_MAX_ATTEMPTS = 3;

type VoiceGender = "male" | "female";

const GEMINI_VOICES: Record<string, Partial<Record<VoiceGender, string[]>>> = {
  standard: { female: ["Kore"], male: ["Puck"] },
  "studio-female-1": { female: ["Aoede", "Kore"] },
  "studio-female-2": { female: ["Zephyr", "Leda"] },
  "studio-male-1": { male: ["Puck"] },
  "studio-male-2": { male: ["Charon", "Fenrir"] },
};

export function voice(
  voiceId: string | undefined,
  _langCode: string,
  gender: VoiceGender,
): string[] {
  const sets = GEMINI_VOICES[voiceId ?? "standard"] ?? GEMINI_VOICES.standard;
  return sets[gender] ?? sets.female ?? [];
}

export async function tts(
  text: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
): Promise<SpeechAttempt> {
  const voiceName = voice ?? env.TTS_GEMINI_VOICE ?? "Kore";
  try {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);

    let response: Response | null = null;
    let lastStatus: number | null = null;

    for (let attempt = 1; attempt <= GEMINI_SPEECH_MAX_ATTEMPTS; attempt++) {
      const rotation = await rotateKeysDetailed(
        env,
        "GEMINI_KEY_",
        (key) =>
          fetchWithTimeout(
            GEMINI_SPEECH_URL,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": key,
                ...getClientHeaders(),
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [{ text: `${GEMINI_SPEECH_PROMPT} ${text}` }],
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

      if (response || (lastStatus ?? 0) < 500) break;
    }

    if (!response) {
      return { result: null, status: lastStatus };
    }

    const data = await response.json<GeminiSpeechResponse>();
    const inlineData = data.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    )?.inlineData;

    if (!inlineData?.data || !inlineData.mimeType?.includes("audio/L16")) {
      logger.warn("[gemini] speech: no L16 PCM audio in response");
      return { result: null, status: 502 };
    }

    const pcmBytes = base64ToBytes(inlineData.data);
    if (pcmBytes.byteLength === 0 || pcmBytes.byteLength % 2 !== 0) {
      logger.warn("[gemini] speech: invalid PCM length", {
        bytes: pcmBytes.byteLength,
      });
      return { result: null, status: 502 };
    }
    if (pcmBytes.byteLength > MAX_SPEECH_BYTES) {
      logger.warn("[gemini] speech: PCM output over hard cap", {
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
    logger.error("[gemini] speech exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { result: null, status: null };
  }
}
