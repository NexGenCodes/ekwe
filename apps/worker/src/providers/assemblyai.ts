import { Env, TranscribeResult } from "@/core/types";
import { rotateKeys } from "@/utils/keys";
import { isHallucination } from "@/utils/hallucination";
import { fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { pollUntilReady } from "@/utils/poll";
import { rotateWsKeys, createOpusDecodingInterceptor } from "@/utils/stream";
import { logger } from "@/core/logger";

const ASSEMBLYAI_UPLOAD = "https://api.assemblyai.com/v2/upload";
const ASSEMBLYAI_TRANSCRIPT = "https://api.assemblyai.com/v2/transcript";

interface AssemblyResult {
  status?: string;
  text?: string;
  error?: string;
  audio_duration?: number;
  language_code?: string;
}

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const res = await rotateKeys(
    env,
    "ASSEMBLYAI_KEY_",
    async (key) => {
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
          const err = await uploadRes.text().catch(() => "No body");
          logger.error(
            "[CREDIT_EXHAUSTED] AssemblyAI key requires manual rotation!",
            {
              status: uploadRes.status,
              body: err,
            },
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
      const { upload_url } = await uploadRes.json<{ upload_url: string }>();

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
          const err = await createRes.text().catch(() => "No body");
          logger.error(
            "[CREDIT_EXHAUSTED] AssemblyAI key requires manual rotation!",
            {
              status: createRes.status,
              body: err,
            },
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
      const { id } = await createRes.json<{ id: string }>();

      const polled = await pollUntilReady<AssemblyResult>({
        url: `${ASSEMBLYAI_TRANSCRIPT}/${id}`,
        headers: { Authorization: key },
        signal,
        isError: (data) => {
          const d = data as AssemblyResult;
          if (d.status === "error") {
            logger.error("[assemblyai] Processing error", {
              error: d.error,
            });
            return new Response(null, { status: 500 });
          }
          return null;
        },
        parse: (data) => {
          const d = data as AssemblyResult;
          if (d.status === "completed" && d.text) return d;
          return null;
        },
      });

      if (polled.ok && polled.value) {
        return new Response(
          JSON.stringify({
            text: polled.value.text,
            duration: polled.value.audio_duration,
            language: polled.value.language_code,
          }),
          { status: 200 },
        );
      }
      return polled.response ?? new Response(null, { status: 504 });
    },
    signal,
  );

  if (!res?.ok) return null;

  const finalData = await res.json<{
    text: string;
    duration?: number;
    language?: string;
  }>();
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

export async function sttStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
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

  createOpusDecodingInterceptor(
    clientWs,
    aaiWs,
    (data) => {
      try {
        const payload = JSON.parse(data) as {
          message_type?: string;
          text?: string;
        };
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
    },
    false,
    16000,
    signal,
  );

  return true;
}

export { ALL_LANGUAGES as supportedLanguages } from "@/core/languages";
