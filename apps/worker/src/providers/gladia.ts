import { Env, TranscribeResult } from "@/core/types";
import { providerKeys, rotateKeys } from "@/utils/keys";
import { isHallucination } from "@/utils/hallucination";
import { fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { pollUntilReady } from "@/utils/poll";
import { mimeToExt } from "@/utils/mime";
import { openWebSocket, createStreamInterceptor } from "@/utils/stream";
import { logger } from "@/core/logger";
import {
  toProviderCode,
  type StreamRoute,
} from "@ekwe/shared/languageCapabilities";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

const GLADIA_UPLOAD = "https://api.gladia.io/v2/upload";
const GLADIA_TRANSCRIPTION = "https://api.gladia.io/v2/pre-recorded";

export async function stt(
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
    // Folded through the shared resolver like every other provider, so the
    // field is a canonical code or absent rather than whatever spelling the
    // provider used.
    const detected = canonicalLanguageFromName(data.language);
    return {
      text: data.text,
      provider: "gladia",
      ...(detected ? { language: detected } : {}),
    };
  }

  return null;
}

async function attemptTranscription(
  blob: Blob,
  lang: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
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
    logger.warn("[gladia] Upload failed, provider returned error", {
      status: uploadRes.status,
    });
    return uploadRes;
  }

  const { audio_url } = await uploadRes.json<{ audio_url: string }>();

  const isAuto = !lang || lang === "auto";
  const transcriptBody: Record<string, unknown> = {
    audio_url,
  };
  if (!isAuto) {
    transcriptBody.language_config = {
      languages: [toProviderCode("gladia", "stt", lang)],
    };
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
    logger.warn("[gladia] Submit failed, provider returned error", {
      status: submitRes.status,
    });
    return submitRes;
  }

  const { result_url } = await submitRes.json<{ result_url: string }>();

  const polled = await pollUntilReady<GladiaResult>({
    url: result_url,
    headers: { "x-gladia-key": apiKey },
    signal,
    onPoll: (attempt, data) => {
      logger.info("[gladia] Polling for results...", {
        attempt,
        status: (data as GladiaResult).status,
      });
    },
    isError: (data) => {
      const d = data as GladiaResult;
      if (d.status === "error") {
        logger.error("[gladia] Transcription job failed", { data: d });
        return Response.json({ error: "gladia_error" }, { status: 502 });
      }
      return null;
    },
    parse: (data) => {
      const d = data as GladiaResult;
      if (d.status === "done") return d;
      return null;
    },
  });

  if (polled.ok && polled.value) {
    const text = polled.value.result?.transcription?.full_transcript || "";
    const language =
      polled.value.result?.transcription?.languages?.[0]?.language;
    logger.info("[gladia] Transcription completed", { language });
    return Response.json({ text, language }, { status: 200 });
  }
  return (
    polled.response ??
    Response.json({ error: "gladia_timeout" }, { status: 504 })
  );
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

interface GladiaUtterance {
  text?: string;
  language?: string;
}

interface GladiaLiveMessage {
  type?: string;
  data?: { is_final?: boolean; utterance?: GladiaUtterance };
}

interface GladiaLiveSession {
  url: string;
}

/**
 * Gladia `/v2/live`: a signed single-use socket URL from a POST, and a message
 * shape unrelated to v1. Verified live; see `docs/gladia-v2-findings.md`.
 */
export async function sttStream(
  env: Env,
  route: StreamRoute,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const session = await createLiveSession(env, lang, signal);
  if (!session) return false;

  const glWs = await openWebSocket(session.url);
  if (!glWs) return false;

  createStreamInterceptor(
    clientWs,
    glWs,
    (data) => {
      try {
        const payload = JSON.parse(data) as GladiaLiveMessage;
        if (payload.type !== "transcript") return;
        const utterance = payload.data?.utterance;
        const text = utterance?.text;
        if (!text || isHallucination(text)) return;
        // Cumulative, not a delta: the client replaces its interim copy and
        // appends this once. `language` is on every event, partials included.
        clientWs.send(
          JSON.stringify({
            type: payload.data?.is_final === true ? "final" : "interim",
            text,
            provider: "gladia",
            ...(utterance.language
              ? { language: canonicalLanguageFromName(utterance.language) }
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

/** Omitting `language_config` is what turns detection on. */
async function createLiveSession(
  env: Env,
  lang: string,
  signal: AbortSignal,
): Promise<GladiaLiveSession | null> {
  const body: Record<string, unknown> = {
    encoding: "wav/pcm",
    sample_rate: 16000,
    bit_depth: 16,
    channels: 1,
    messages_config: { receive_partial_transcripts: true },
  };

  if (lang && lang !== "auto") {
    body.language_config = {
      // Gladia takes the Whisper spelling: `jw` for our `jv`, `no` for `nb`.
      languages: [toProviderCode("gladia", "stt", lang)],
      code_switching: true,
    };
  }

  for (const key of providerKeys(env, "GLADIA_KEY_")) {
    const session = await postLiveSession(key, body, signal);
    if (session) return session;
  }
  return null;
}

async function postLiveSession(
  key: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<GladiaLiveSession | null> {
  try {
    const res = await fetchWithTimeout(
      "https://api.gladia.io/v2/live",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-gladia-key": key },
        body: JSON.stringify(body),
      },
      TIMEOUT_FAST,
      signal,
    );
    if (!res.ok) {
      logger.warn("[gladia] /v2/live rejected", {
        status: res.status,
        requested: body.language_config,
      });
      return null;
    }
    const parsed: { url?: string } = await res.json();
    return parsed.url ? { url: parsed.url } : null;
  } catch {
    return null;
  }
}
