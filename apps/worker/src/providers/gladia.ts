import { Env, TranscribeResult } from "../core/types";
import { rotateKeys } from "../utils/keys";
import { isHallucination } from "../utils/prompts";
import { fetchWithTimeout, logProviderError, TIMEOUT_FAST, abortableDelay } from "../utils/fetch";
import { mimeToExt } from "../utils/mime";
import { rotateWsKeys, createStreamInterceptor } from "../utils/websocket";
import { logger } from "../core/logger";

const GLADIA_UPLOAD = "https://api.gladia.io/v2/upload";
const GLADIA_TRANSCRIPTION = "https://api.gladia.io/v2/pre-recorded";
const POLL_INTERVAL = 2000;
const MAX_POLLS = 4; // 8s max wait

/**
 * Gladia pre-recorded transcription — async upload → poll pattern.
 * Slower than direct providers, use as a fallback.
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const res = await rotateKeys(
    env,
    "GLADIA_KEY_",
    (key) => attemptTranscription(blob, lang, key, signal),
    signal,
  );

  if (!res?.ok) return null;

  const data = await res.json<{ text?: string; language?: string }>();
  if (data.text && !isHallucination(data.text)) {
    return { text: data.text, provider: "gladia", language: data.language };
  }

  return null;
}

async function attemptTranscription(
  blob: Blob,
  lang: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  // Step 1: Upload audio
  const uploadForm = new FormData();
  uploadForm.append("audio", blob, `audio.${mimeToExt(blob.type)}`);

  const uploadRes = await fetchWithTimeout(
    GLADIA_UPLOAD,
    {
      method: "POST",
      headers: { "x-gladia-key": apiKey },
      body: uploadForm,
    },
    TIMEOUT_FAST,
    signal,
  );

  if (!uploadRes.ok) {
    await logProviderError("gladia upload", uploadRes);
    return uploadRes;
  }

  const { audio_url } = await uploadRes.json<{ audio_url: string }>();

  // Step 2: Submit transcription request
  const isAuto = !lang || lang === "auto";
  const transcriptBody: Record<string, unknown> = {
    audio_url,
  };
  if (!isAuto) {
    transcriptBody.language_config = { languages: [lang] };
  }

  const submitRes = await fetchWithTimeout(
    GLADIA_TRANSCRIPTION,
    {
      method: "POST",
      headers: { "x-gladia-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(transcriptBody),
    },
    TIMEOUT_FAST,
    signal,
  );

  if (!submitRes.ok) {
    await logProviderError("gladia submit", submitRes);
    return submitRes;
  }

  const { result_url } = await submitRes.json<{ result_url: string }>();

  // Step 3: Poll for result
  for (let i = 0; i < MAX_POLLS; i++) {
    await abortableDelay(POLL_INTERVAL, signal);

    const poll = await fetchWithTimeout(
      result_url,
      {
        headers: { "x-gladia-key": apiKey },
        signal,
      },
      TIMEOUT_FAST,
      signal,
    );

    const data = await poll.json<GladiaResult>();

    if (data.status === "done") {
      const text = data.result?.transcription?.full_transcript || "";
      const language = data.result?.transcription?.languages?.[0]?.language;
      logger.info("[gladia] Transcription completed", { language });
      return Response.json({ text, language }, { status: 200 });
    }
    if (data.status === "error") {
      logger.error("[gladia] Transcription job failed", { data });
      return Response.json({ error: "gladia_error" }, { status: 502 });
    }

    logger.info("[gladia] Polling for results...", {
      attempt: i + 1,
      status: data.status,
    });
  }

  return Response.json({ error: "gladia_timeout" }, { status: 504 });
}

interface GladiaResult {
  status?: string;
  result?: {
    transcription?: {
      full_transcript?: string;
      languages?: Array<{ language?: string }>;
    };
  };
}

export { ALL_LANGUAGES as supportedLanguages } from "../services/languages";

/**
 * Handles a real-time streaming session via Gladia WebSocket.
 * Returns true if the session was handled, false if the provider could not connect.
 */
export async function handleStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  _signal: AbortSignal,
): Promise<boolean> {
  const glWs = await rotateWsKeys(env, "GLADIA_KEY_", (key) => {
    const params = new URLSearchParams({
      sample_rate: "16000",
      channels: "1",
      encoding: "opus",
      x_gladia_key: key,
    });
    if (lang && lang !== "auto") params.set("language", lang);
    return `wss://api.gladia.io/audio/text/audio-transcription?${params}`;
  });
  if (!glWs) return false;

  createStreamInterceptor(clientWs, glWs, (data) => {
    try {
      const payload = JSON.parse(data) as {
        type?: string;
        transcription?: string;
        time_end?: number;
      };
      if (payload.type === "transcript" && payload.transcription) {
        const text = payload.transcription;
        const isFinal = payload.time_end !== undefined;

        if (text && !isHallucination(text)) {
          clientWs.send(
            JSON.stringify({
              type: isFinal ? "final" : "interim",
              text,
              provider: "gladia",
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
