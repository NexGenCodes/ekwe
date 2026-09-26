import { logger } from "@/core/logger";
import {
  Env,
  CLIENT_ABORTED,
  TranscribeResult,
  SpeechAttempt,
} from "@/core/types";
import { sanitizeKey, rotateKeysDetailed } from "@/utils/keys";
import { getWitSecretKey } from "@/utils/wit-pools";
import { isHallucination } from "@/utils/hallucination";
import {
  fetchWithIdleTimeout,
  fetchWithTimeout,
  getUserAgent,
  TIMEOUT_SLOW,
  TIMEOUT_FAST,
} from "@/utils/fetch";
import { decodeOpusFrame, isOpusDecoderReady } from "@/utils/opus";
import { pcmToWav } from "@/utils/wav";
import { mergePcmFrames } from "@/utils/pcm";
import { clientMessageToBytes } from "@/utils/stream";

const WITAI_DICTATION = "https://api.wit.ai/dictation?v=20240304";
const WITAI_SYNTH_URL = "https://api.wit.ai/synthesize?v=20240304";

export const MAX_PENDING_OPUS_FRAMES = 512;

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const targetLang = lang.toUpperCase().replace("-", "_");
  const baseLang = targetLang.split("_")[0];
  const witKey = sanitizeKey(await getWitSecretKey(env, targetLang, baseLang));

  if (!witKey) {
    logger.warn("[witai] Skipping: No API key found", {
      lang,
      targetLang,
      baseLang,
    });
    return null;
  }

  const contentType = toWitMime(blob.type);
  if (!contentType) {
    logger.warn("[witai] Skipping: Unsupported MIME type", { type: blob.type });
    return null;
  }

  logger.info("[witai] Sending request", {
    lang,
    contentType,
    blobSize: blob.size,
    blobType: blob.type,
  });

  const res = await fetchWithIdleTimeout(
    WITAI_DICTATION,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${witKey}`,
        "Content-Type": contentType,
        "User-Agent": getUserAgent(),
      },
      body: blob,
    },
    TIMEOUT_SLOW,
    signal,
  );

  if (!res.ok) {
    logger.warn("[witai] Transcribe failed, provider returned error", {
      status: res.status,
    });
    return null;
  }

  const data = await parseStream(res);
  if (data?.text && !isHallucination(data.text)) {
    return { text: data.text, provider: "witai", language: lang };
  }

  if (data?.text) {
    logger.warn("[witai] Transcript discarded as hallucination", {
      text: data.text.substring(0, 50),
    });
  } else {
    logger.warn("[witai] No transcript returned in stream response");
  }

  return null;
}

async function parseStream(res: Response): Promise<{ text: string } | null> {
  const raw = await res.text();
  return parseJsonStream(raw);
}

export async function sttStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const targetLang = lang.toUpperCase().replace("-", "_");
  const baseLang = targetLang.split("_")[0];
  const witKey = sanitizeKey(await getWitSecretKey(env, targetLang, baseLang));
  if (!witKey) return false;

  logger.info("[witai:stream] Starting dictation session", { lang });

  let pcmFrames: Int16Array[] = [];
  let lastFlush = Date.now();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pendingFrames: Uint8Array[] = [];

  const flushPcm = (): void => {
    if (pcmFrames.length === 0) return;
    const merged = mergePcmFrames(pcmFrames);
    pcmFrames = [];
    const wav = pcmToWav(merged, 16000);
    controllerRef?.enqueue(wav);
  };

  const handleMessage = async (event: MessageEvent): Promise<void> => {
    const data = await clientMessageToBytes(event);
    if (!data) return;

    if (isOpusDecoderReady()) {
      const frames = [...pendingFrames, data];
      pendingFrames = [];
      for (const frame of frames) {
        const pcm = decodeOpusFrame(frame, 16000);
        if (pcm) {
          pcmFrames.push(pcm);
          const now = Date.now();
          if (now - lastFlush > 500 || pcmFrames.length >= 25) {
            flushPcm();
            lastFlush = now;
          }
        }
      }
    } else {
      pendingFrames.push(data);
      if (pendingFrames.length > MAX_PENDING_OPUS_FRAMES) {
        pendingFrames.splice(0, pendingFrames.length - MAX_PENDING_OPUS_FRAMES);
        logger.warn(
          "[witai] Opus decoder late; dropping earliest pending frames",
        );
      }
    }
  };

  const onMessage = (event: MessageEvent): void => {
    void handleMessage(event).catch((e) => {
      logger.error("[witai] Stream message handler error", {
        error: e instanceof Error ? e.message : String(e),
      });
    });
  };

  const onClose = (): void => {
    flushPcm();
    if (controllerRef) {
      try {
        controllerRef.close();
      } catch {
        /* already closed */
      }
    }
  };

  const detach = (): void => {
    clientWs.removeEventListener("message", onMessage);
    clientWs.removeEventListener("close", onClose);
  };

  const audioStream = new ReadableStream({
    start(controller) {
      controllerRef = controller;

      clientWs.addEventListener("message", onMessage);
      clientWs.addEventListener("close", onClose);

      signal.addEventListener("abort", () => {
        flushPcm();
        detach();
        if (controllerRef) {
          try {
            controllerRef.close();
          } catch {
            /* ignore */
          }
        }
      });
    },
  });

  try {
    const res = await fetchWithIdleTimeout(
      WITAI_DICTATION,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${witKey}`,
          "Content-Type": "audio/wav",
        },
        body: audioStream,
        duplex: "half",
      } as RequestInit & { duplex: string },
      TIMEOUT_SLOW,
      signal,
    );

    if (!res.ok) {
      detach();
      logger.warn("[witai] Stream failed, provider returned error", {
        status: res.status,
      });
      return false;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      detach();
      logger.error("[witai:stream] No response body");
      return false;
    }
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const trimmed = part.replace(/\r$/, "").trim();
        if (!trimmed) continue;

        try {
          const data = JSON.parse(trimmed) as {
            text?: string;
            type?: string;
            is_final?: boolean;
            error?: string;
          };

          if (data.error) {
            logger.error("[witai:stream] Error in stream", {
              error: data.error,
            });
            continue;
          }

          if (data.text && !isHallucination(data.text)) {
            const isFinal = data.type === "final" || data.is_final === true;
            clientWs.send(
              JSON.stringify({
                type: isFinal ? "final" : "interim",
                text: data.text,
                provider: "witai",
              }),
            );
          }
        } catch {
          /* incomplete JSON, wait for more data */
        }
      }
    }

    detach();
    return true;
  } catch (err) {
    detach();
    logger.error("[witai:stream] Request failed", { error: String(err) });
    return false;
  }
}

function parseJsonStream(raw: string): { text: string } | null {
  const cleaned = raw.replace(/^\uFEFF/, "");
  logger.info("[witai] Raw response", {
    length: cleaned.length,
    snippet: cleaned.substring(0, 500),
  });

  if (!cleaned.trim()) {
    logger.warn("[witai] Empty response body");
    return null;
  }

  const parts = cleaned.split("\n");
  let last: { text?: string } | null = null;
  let prev = "";

  for (const chunk of parts) {
    const trimmed = chunk.replace(/\r$/, "").trim();
    if (!trimmed) continue;

    try {
      prev += trimmed;
      last = JSON.parse(prev) as { text?: string };
      prev = "";
    } catch {
      /* incomplete, keep building */
    }
  }

  if (!last?.text?.trim()) return null;

  logger.info("[witai] Final transcript", {
    text: last.text.substring(0, 100),
  });
  return { text: last.text.trim() };
}

function toWitMime(mime: string): string | null {
  const baseMime = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string | null> = {
    "audio/mpeg": "audio/mpeg3",
    "audio/mp3": "audio/mpeg3",
    "audio/mpeg3": "audio/mpeg3",
    "audio/mp4": null,
    "audio/m4a": null,
    "audio/x-m4a": null,
    "audio/aac": null,
    "audio/wav": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/ogg": "audio/ogg",
    "audio/opus": "audio/ogg",
    "audio/webm": "audio/webm",
    "audio/ulaw": "audio/ulaw",
    "audio/raw": "audio/raw",
  };
  return map[baseMime] ?? null;
}

const WITAI_LANGUAGES = new Set([
  "af",
  "ak",
  "sq",
  "am",
  "ar",
  "hy",
  "as",
  "ay",
  "az",
  "eu",
  "be",
  "bn",
  "bs",
  "br",
  "bg",
  "my",
  "ca",
  "ci",
  "ck",
  "ny",
  "zh",
  "hr",
  "cs",
  "da",
  "dv",
  "nl",
  "en",
  "eo",
  "et",
  "fo",
  "fi",
  "fr",
  "ff",
  "gl",
  "lg",
  "ka",
  "de",
  "el",
  "gn",
  "gu",
  "ht",
  "ha",
  "he",
  "hi",
  "hu",
  "is",
  "ig",
  "id",
  "iu",
  "ga",
  "it",
  "ja",
  "jv",
  "kl",
  "kn",
  "ks",
  "kk",
  "km",
  "rw",
  "ky",
  "ko",
  "ku",
  "lo",
  "la",
  "lv",
  "li",
  "ln",
  "lt",
  "mk",
  "mg",
  "ms",
  "ml",
  "mt",
  "mi",
  "mr",
  "mn",
  "ne",
  "se",
  "no",
  "nb",
  "or",
  "om",
  "pa",
  "ps",
  "fa",
  "pl",
  "pt",
  "qu",
  "rm",
  "ro",
  "ru",
  "sa",
  "sc",
  "gd",
  "sr",
  "sn",
  "sd",
  "si",
  "sk",
  "sl",
  "so",
  "st",
  "nr",
  "es",
  "su",
  "sw",
  "ss",
  "sv",
  "tl",
  "tg",
  "ta",
  "tt",
  "te",
  "th",
  "bo",
  "ti",
  "ts",
  "tn",
  "tr",
  "ug",
  "uk",
  "ur",
  "uz",
  "ve",
  "vi",
  "cy",
  "fy",
  "wo",
  "xh",
  "yi",
  "yo",
  "zu",
]);
export { WITAI_LANGUAGES as supportedLanguages };

const MAX_SPEECH_BYTES = 8 * 1024 * 1024;

type VoiceGender = "male" | "female";

/**
 * Order is the persona contract: index 0 is the Clear voice, index 1 the Warm
 * voice. Wit has no per-language voice identity, so one list per gender serves
 * every locale.
 *
 * Only these four names are enabled. Wit free-tier voice access is
 * account-assigned and an unassigned name fails the request outright; with
 * `HEALTH_TRIP_THRESHOLD = 3`, three such attempts open this provider's
 * circuit for the whole pool. `wit$Railey`, `wit$Rubie`, `wit$Charlie` and
 * `wit$Carl` are documented and appropriate, but must be confirmed against the
 * live Ekwe key before being added here.
 */
const WITAI_VOICE_POOL: Readonly<
  Record<VoiceGender | "default", readonly string[]>
> = {
  default: ["wit$Remi"],
  // [0] Remi · Natural   [1] Rebecca · Professional
  female: ["wit$Remi", "wit$Rebecca"],
  // [0] Cody · Natural   [1] Cooper · Professional
  male: ["wit$Cody", "wit$Cooper"],
};

const WITAI_VOICES = new Set(Object.values(WITAI_VOICE_POOL).flat());

export function voices(
  gender: VoiceGender | undefined,
  _langCode: string,
): string[] {
  if (gender) return [...WITAI_VOICE_POOL[gender]];
  return [...WITAI_VOICE_POOL.default];
}

export async function tts(
  text: string,
  _lang: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
): Promise<SpeechAttempt> {
  if (signal.aborted || !text || !text.trim()) {
    return { result: null, status: null };
  }

  const resolvedVoice =
    voice && WITAI_VOICES.has(voice) ? voice : WITAI_VOICE_POOL.default[0];
  try {
    const rotation = await rotateKeysDetailed(
      env,
      "WIT_KEY_",
      (key) =>
        fetchWithTimeout(
          WITAI_SYNTH_URL,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              Accept: "audio/mpeg",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              q: text,
              voice: resolvedVoice,
              style: "default",
              speed: "100",
              pitch: "100",
              fformat: "mp3",
            }).toString(),
          },
          TIMEOUT_FAST,
          signal,
        ),
      signal,
    );

    if (!rotation.response) {
      const status = rotation.lastStatus;
      if (
        status === 429 ||
        status === 503 ||
        status === 401 ||
        status === 403
      ) {
        logger.warn("[witai:tts] Synth failed", { status });
        return { result: null, status };
      }
      return { result: null, status: null };
    }

    const bytes = new Uint8Array(await rotation.response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SPEECH_BYTES) {
      logger.warn("[witai:tts] Output over hard cap", {
        bytes: bytes.byteLength,
      });
      return { result: null, status: 502 };
    }

    return {
      result: {
        audio: bytes,
        mime: "audio/mpeg",
        provider: "witai",
      },
      status: null,
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[witai:tts] Synth exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { result: null, status: null };
  }
}
