import { Env, TranscribeResult } from "../types";
import { rotateKeys } from "../utils/keys";
import { isHallucination } from "../utils/prompts";
import { fetchWithTimeout, TIMEOUT_FAST, abortableDelay } from "../utils/fetch";
import {
  rotateWsKeys,
  createOpusDecodingInterceptor,
} from "../utils/websocket";
import { logger } from "../logger";

const ASSEMBLYAI_UPLOAD = "https://api.assemblyai.com/v2/upload";
const ASSEMBLYAI_TRANSCRIPT = "https://api.assemblyai.com/v2/transcript";
const POLL_INTERVAL = 2000;
const MAX_POLLS = 4; // 8s max wait

/**
 * AssemblyAI — async upload → poll pattern.
 * Multi-key rotation. High maintenance (one-time $50 credit).
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const res = await rotateKeys(
    env,
    "ASSEMBLYAI_KEY_",
    async (key) => {
      // Step 1: Upload audio
      const uploadRes = await fetchWithTimeout(
        ASSEMBLYAI_UPLOAD,
        {
          method: "POST",
          headers: {
            Authorization: key,
            "Content-Type": "application/octet-stream",
          },
          body: blob,
        },
        TIMEOUT_FAST,
        signal,
      );

      if (!uploadRes.ok) {
        if (uploadRes.status === 402 || uploadRes.status === 403) {
          logger.error(
            "[CREDIT_EXHAUSTED] AssemblyAI key requires manual rotation!",
          );
        } else {
          const err = await uploadRes.text().catch(() => "No body");
          logger.error("[assemblyai] Upload error", {
            status: uploadRes.status,
            body: err,
          });
        }
        return new Response(null, { status: uploadRes.status });
      }
      const { upload_url } = (await uploadRes.json()) as { upload_url: string };

      // Step 2: Create transcript
      const isAuto = !lang || lang === "auto";
      const createBody: Record<string, unknown> = {
        audio_url: upload_url,
        speech_models: ["universal-3-5-pro", "universal-2"],
      };
      if (isAuto) {
        createBody.language_detection = true;
      } else {
        createBody.language_code = lang;
      }

      const createRes = await fetchWithTimeout(
        ASSEMBLYAI_TRANSCRIPT,
        {
          method: "POST",
          headers: {
            Authorization: key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(createBody),
        },
        TIMEOUT_FAST,
        signal,
      );

      if (!createRes.ok) {
        if (createRes.status === 402 || createRes.status === 403) {
          logger.error(
            "[CREDIT_EXHAUSTED] AssemblyAI key requires manual rotation!",
          );
        } else {
          const err = await createRes.text().catch(() => "No body");
          logger.error("[assemblyai] Create error", {
            status: createRes.status,
            body: err,
          });
        }
        return new Response(null, { status: createRes.status });
      }
      const { id } = (await createRes.json()) as { id: string };

      // Step 3: Poll for result
      for (let i = 0; i < MAX_POLLS; i++) {
        await abortableDelay(POLL_INTERVAL, signal);

        const poll = await fetchWithTimeout(
          `${ASSEMBLYAI_TRANSCRIPT}/${id}`,
          { headers: { Authorization: key }, signal },
          TIMEOUT_FAST,
          signal,
        );

        const data = (await poll.json()) as AssemblyResult;

        if (data.status === "completed" && data.text) {
          return new Response(
            JSON.stringify({
              text: data.text,
              duration: data.audio_duration,
              language: data.language_code,
            }),
            { status: 200 },
          );
        }
        if (data.status === "error") {
          logger.error("[assemblyai] Processing error", { error: data.error });
          return new Response(null, { status: 500 });
        }
      }
      return new Response(null, { status: 504 });
    },
    signal,
  );

  if (!res?.ok) return null;

  const finalData = (await res.json()) as {
    text: string;
    duration?: number;
    language?: string;
  };
  const durationMs = finalData.duration ? finalData.duration * 1000 : undefined;
  if (!isHallucination(finalData.text, durationMs)) {
    return {
      text: finalData.text,
      provider: "assemblyai",
      duration: finalData.duration,
      language: finalData.language,
    };
  }

  return null;
}

interface AssemblyResult {
  status?: string;
  text?: string;
  error?: string;
  audio_duration?: number;
  language_code?: string;
}

export { ALL_LANGUAGES as supportedLanguages } from "../languages";

/**
 * Handles a real-time streaming session via AssemblyAI WebSocket.
 * Returns true if the session was handled, false if the provider could not connect.
 */
export async function handleStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  _signal: AbortSignal,
): Promise<boolean> {
  const aaiWs = await rotateWsKeys(env, "ASSEMBLYAI_KEY_", (key) => {
    const params = new URLSearchParams({
      sample_rate: "16000",
      token: key,
    });
    if (lang && lang !== "auto") params.set("language_code", lang);
    return `wss://api.assemblyai.com/v2/realtime/ws?${params}`;
  });
  if (!aaiWs) return false;

  createOpusDecodingInterceptor(clientWs, aaiWs, (data) => {
    try {
      const payload = JSON.parse(data);
      if (
        payload.message_type === "PartialTranscript" ||
        payload.message_type === "FinalTranscript"
      ) {
        const text = payload.text;
        const isFinal = payload.message_type === "FinalTranscript";

        if (text && !isHallucination(text)) {
          clientWs.send(
            JSON.stringify({
              type: isFinal ? "final" : "interim",
              text,
              provider: "assemblyai",
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
