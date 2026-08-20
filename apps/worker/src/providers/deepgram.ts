import { Env, TranscribeResult, TtsAttempt } from "../core/types";
import { rotateKeys } from "../utils/keys";
import { isHallucination } from "../utils/prompts";
import { fetchWithTimeout, TIMEOUT_FAST } from "../utils/fetch";
import { runAiTtsRaw } from "../utils/ai";
import { rotateWsKeys, createStreamInterceptor } from "../utils/websocket";
import { logger } from "../core/logger";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

/**
 * Deepgram Nova-2 — fast single-POST transcription.
 * Supports auto-detection when language param is omitted.
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  logger.info("[deepgram] Requesting transcription", {
    lang,
    size: blob.size,
    type: blob.type,
  });
  const params = new URLSearchParams({ model: "nova-3" });
  if (lang && lang !== "auto") params.set("language", lang);

  const res = await rotateKeys(
    env,
    "DEEPGRAM_KEY_",
    (key) =>
      fetchWithTimeout(
        `${DEEPGRAM_URL}?${params}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${key}`,
            "Content-Type": blob.type || "audio/wav",
          },
          body: blob,
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    if (res?.status === 402 || res?.status === 403) {
      logger.error("[CREDIT_EXHAUSTED] Deepgram key requires manual rotation!");
    } else {
      logger.warn("[deepgram] Transcribe failed, provider returned error", {
        status: res?.status ?? "no response",
      });
    }
    return null;
  }

  const data = await res.json<DeepgramResponse>();
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  const detectedLang = data.results?.channels?.[0]?.detected_language;
  const duration = data.metadata?.duration;
  const durationMs = duration ? duration * 1000 : undefined;

  if (transcript && !isHallucination(transcript, durationMs)) {
    return {
      text: transcript,
      provider: "deepgram",
      duration,
      language: detectedLang,
    };
  }

  return null;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
      detected_language?: string;
    }>;
  };
  metadata?: { duration?: number };
}

export { DEEPGRAM_LANGUAGES as supportedLanguages } from "../services/languages";

// ─── Text-to-Speech (Aura models) ─────────────────────────────────
// Aura 1/2 are Deepgram voices. They're served through the zero-key Workers
// AI binding (as MP3), so `/tts` uses `env.AI.run` rather than the Deepgram
// REST API and needs no DEEPGRAM_KEY_*.

const AURA_MODELS = {
  "aura-2-en": "@cf/deepgram/aura-2-en",
  "aura-2-es": "@cf/deepgram/aura-2-es",
  "aura-1": "@cf/deepgram/aura-1",
} as const;

async function runSpeechModel(
  model: (typeof AURA_MODELS)[keyof typeof AURA_MODELS],
  input: Record<string, unknown>,
  provider: string,
  env: Env,
): Promise<TtsAttempt> {
  return runAiTtsRaw(env, model, input, provider);
}

/** Aura 2 (en/es) — higher-fidelity MP3 voices. */
export function aura2(
  text: string,
  lang: "en" | "es",
  env: Env,
  speaker?: string,
): Promise<TtsAttempt> {
  const model =
    lang === "es" ? AURA_MODELS["aura-2-es"] : AURA_MODELS["aura-2-en"];
  return runSpeechModel(
    model,
    { text, speaker: speaker ?? env.TTS_AURA2_SPEAKER ?? "luna" },
    "aura2",
    env,
  );
}

/** Aura 1 (en) — fallback MP3 voice. */
export function aura1(
  text: string,
  env: Env,
  speaker?: string,
): Promise<TtsAttempt> {
  return runSpeechModel(
    AURA_MODELS["aura-1"],
    { text, speaker: speaker ?? "angus" },
    "aura1",
    env,
  );
}

/**
 * Handles a real-time streaming session via Deepgram WebSocket.
 * Returns true if the session was handled, false if the provider could not connect.
 */
export async function handleStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  _signal: AbortSignal,
): Promise<boolean> {
  const dgWs = await rotateWsKeys(env, "DEEPGRAM_KEY_", (key) => {
    const params = new URLSearchParams({
      access_token: key,
      encoding: "opus",
      sample_rate: "16000",
      channels: "1",
      model: "nova-3",
      interim_results: "true",
      smart_format: "true",
    });
    if (lang && lang !== "auto") params.set("language", lang);
    return `wss://api.deepgram.com/v1/listen?${params}`;
  });
  if (!dgWs) return false;

  createStreamInterceptor(clientWs, dgWs, (data) => {
    try {
      const payload = JSON.parse(data) as {
        type?: string;
        channel?: { alternatives?: Array<{ transcript?: string }> };
        is_final?: boolean;
      };
      const alternatives = payload.channel?.alternatives;
      if (
        payload.type === "Results" &&
        alternatives &&
        alternatives.length > 0
      ) {
        const text = alternatives[0].transcript;
        const isFinal = payload.is_final === true;

        if (text && !isHallucination(text)) {
          clientWs.send(
            JSON.stringify({
              type: isFinal ? "final" : "interim",
              text,
              provider: "deepgram",
            }),
          );
        }
      }
    } catch {
      /* ignore parse errors */
    }
  });

  return true;
}
