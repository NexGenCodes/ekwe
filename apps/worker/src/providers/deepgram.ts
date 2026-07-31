import { Env, TranscribeResult } from "../types";
import { rotateKeys } from "../utils/keys";
import { isHallucination } from "../utils/prompts";
import { fetchWithTimeout, TIMEOUT_FAST } from "../utils/fetch";
import { rotateWsKeys, createStreamInterceptor } from "../utils/websocket";
import { logger } from "../logger";

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
    }
    const errText =
      (await res?.text().catch(() => "No body")) || "Unknown fetch error";
    logger.error("[deepgram] HTTP error", {
      status: res?.status,
      body: errText,
    });
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

export { DEEPGRAM_LANGUAGES as supportedLanguages } from "../languages";

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
