import { Env, TranscribeResult } from "@/core/types";
import { rotateKeysOrThrow } from "@/utils/keys";
import { ProviderHttpError } from "@/core/provider-errors";
import { isHallucination } from "@/utils/hallucination";
import { fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { pollUntilReady } from "@/utils/poll";
import { rotateWsKeys, createStreamInterceptor } from "@/utils/stream";
import { logger } from "@/core/logger";
import {
  toProviderCode,
  type StreamRoute,
} from "@ekwe/shared/languageCapabilities";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

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
  const res = await rotateKeysOrThrow(
    env,
    "ASSEMBLYAI_KEY_",
    "assemblyai",
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
        createBody.language_code = toProviderCode("assemblyai", "stt", lang);
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

  if (!res.ok) throw new ProviderHttpError("assemblyai", res.status);

  const finalData = await res.json<{
    text: string;
    duration?: number;
    language?: string;
  }>();
  const durationMs = finalData.duration ? finalData.duration * 1000 : undefined;
  if (!isHallucination(finalData.text, durationMs)) {
    // Folded through the shared resolver like every other provider, so the
    // field is a canonical code or absent rather than whatever spelling the
    // provider used.
    const detected = canonicalLanguageFromName(finalData.language);
    return {
      text: finalData.text,
      provider: "assemblyai",
      duration: finalData.duration,
      ...(detected ? { language: detected } : {}),
    };
  }

  return null;
}

interface AssemblyAiMessage {
  type?: string;
  text?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  language_code?: string;
}

/**
 * AssemblyAI `/v3/ws` with `u3-rt-pro`, which takes `pcm_s16le` directly and
 * covers six languages. A turn completes only when `end_of_turn` *and*
 * `turn_is_formatted` are both true; the first final alone is unformatted.
 */
export async function sttStream(
  env: Env,
  route: StreamRoute,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const params = new URLSearchParams({
    speech_model: route.model,
    encoding: "pcm_s16le",
    sample_rate: "16000",
    // Low enough that a clause boundary does not split an utterance, high
    // enough that a user who has stopped talking still sees their text.
    min_turn_silence: "200",
    max_turn_silence: "1600",
  });
  if (lang && lang !== "auto") {
    params.set("language_code", toProviderCode("assemblyai", "stt", lang));
  }

  const aaiWs = await rotateWsKeys(env, "ASSEMBLYAI_KEY_", (key) => {
    const withKey = new URLSearchParams(params);
    withKey.set("token", key);
    return `wss://streaming.assemblyai.com/v3/ws?${withKey}`;
  });
  if (!aaiWs) return false;

  createStreamInterceptor(
    clientWs,
    aaiWs,
    (data) => {
      try {
        const payload = JSON.parse(data) as AssemblyAiMessage;
        if (payload.type !== "Turn") return;
        const isFinal =
          payload.end_of_turn === true && payload.turn_is_formatted !== false;
        if (!isFinal) return;
        const text = payload.text;
        if (!text || isHallucination(text)) return;
        clientWs.send(
          JSON.stringify({
            type: "final",
            text,
            provider: "assemblyai",
            ...(payload.language_code
              ? { language: canonicalLanguageFromName(payload.language_code) }
              : {}),
          }),
        );
      } catch {
        /* ignore parse errors */
      }
    },
    { signal },
  );

  return true;
}
