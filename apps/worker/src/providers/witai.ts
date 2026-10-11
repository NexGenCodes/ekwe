import { logger } from "@/core/logger";
import { STREAM_CHUNK_MS } from "@ekwe/shared";
import type { StreamRoute } from "@ekwe/shared/languageCapabilities";
import {
  Env,
  CLIENT_ABORTED,
  TranscribeResult,
  SpeechAttempt,
} from "@/core/types";
import { sanitizeKey } from "@/utils/keys";
import { getWitSecretKey } from "@/utils/wit-pools";
import { isHallucination } from "@/utils/hallucination";
import {
  fetchWithIdleTimeout,
  fetchWithTimeout,
  getUserAgent,
  TIMEOUT_SLOW,
  TIMEOUT_FAST,
} from "@/utils/fetch";
import { wavHeader } from "@/utils/wav";
import { mergePcmFrames } from "@/utils/pcm";

const WITAI_DICTATION = "https://api.wit.ai/dictation?v=20240304";
const WITAI_SYNTH_URL = "https://api.wit.ai/synthesize?v=20240304";

function subarray(bytes: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Wit.ai only parses Vorbis-in-Ogg, whose identification header is the
// packet signature `\x01vorbis`.
async function isOggVorbis(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, 128).arrayBuffer());
  return subarray(bytes, [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
}

async function isOggOpus(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, 128).arrayBuffer());
  let head = "";
  for (const b of bytes) head += String.fromCharCode(b);
  return head.includes("OpusHead");
}

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

  if (contentType === "audio/ogg" && !(await isOggVorbis(blob))) {
    const isOpus = await isOggOpus(blob);
    logger.warn("[witai] Skipping: Ogg container does not hold Vorbis", {
      codec: isOpus ? "Opus" : "unknown",
      type: blob.type,
      size: blob.size,
    });
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
    throw new Error(`Wit.ai returned HTTP ${res.status}`);
  }

  const data = await parseStream(res);
  if (!data?.text) {
    throw new Error("Wit.ai returned an empty transcript");
  }
  if (isHallucination(data.text)) {
    throw new Error("Wit.ai transcript discarded as hallucination");
  }

  return { text: data.text, provider: "witai", language: lang };
}

async function parseStream(res: Response): Promise<{ text: string } | null> {
  const raw = await res.text();
  return parseJsonStream(raw);
}

/**
 * Wit's dictation endpoint is a chunked POST answered with newline-delimited
 * JSON, not a socket, so it does not fit the interceptor and is the only route
 * needing a RIFF header. It has no auto-detection: one key per language.
 */
export async function sttStream(
  env: Env,
  _route: StreamRoute,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const targetLang = lang.toUpperCase().replace("-", "_");
  const baseLang = targetLang.split("_")[0];
  const witKey = sanitizeKey(await getWitSecretKey(env, targetLang, baseLang));
  if (!witKey) return false;

  logger.info("[witai:stream] Starting dictation session", { lang });

  const header = wavHeader(16000);
  let chunk: Int16Array[] = [];
  let lastFlush = Date.now();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let headerSent = false;

  const flush = (): void => {
    if (chunk.length === 0 || !controllerRef) return;
    const merged = mergePcmFrames(chunk);
    chunk = [];
    if (!headerSent) {
      headerSent = true;
      controllerRef.enqueue(header);
    }
    controllerRef.enqueue(new Uint8Array(merged.buffer as ArrayBuffer));
  };

  const closeBody = (): void => {
    flush();
    if (!controllerRef) return;
    try {
      controllerRef.close();
    } catch {
      /* already closed */
    }
  };

  const onMessage = (event: MessageEvent): void => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const data = new Uint8Array(event.data);
    if (data.byteLength < 2) return;
    chunk.push(
      new Int16Array(data.buffer, data.byteOffset, data.byteLength >> 1),
    );
    const now = Date.now();
    if (now - lastFlush >= STREAM_CHUNK_MS || chunk.length >= 25) {
      flush();
      lastFlush = now;
    }
  };

  const detach = (): void => {
    clientWs.removeEventListener("message", onMessage);
    clientWs.removeEventListener("close", closeBody);
  };

  const audioStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      clientWs.addEventListener("message", onMessage);
      clientWs.addEventListener("close", closeBody);
      signal.addEventListener("abort", () => {
        detach();
        closeBody();
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
          "User-Agent": getUserAgent(),
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

    for (;;) {
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
          if (!data.text || isHallucination(data.text)) continue;
          const isFinal = data.type === "final" || data.is_final === true;
          clientWs.send(
            JSON.stringify({
              type: isFinal ? "final" : "interim",
              text: data.text,
              provider: "witai",
              language: lang,
            }),
          );
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

/**
 * Escapes a text node for the `<lang>` element below.
 *
 * The synthesis endpoint takes a bare `<lang xml:lang="..">` child rather than a
 * full SSML document, so the text lands directly inside a tag and any angle
 * bracket in user text would otherwise be parsed as markup. `&` and `'` are
 * escaped too so the same helper is safe if the text is ever placed in an
 * attribute.
 */
const escapeXmlText = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Wraps text in the language hint that makes Wit speak it.
 *
 * Wit resolves a synthesis request's language from the API key, and only
 * `WIT_KEY_EN` is accepted — every other per-language key answers
 * `400 Unsupported language for synthesize`. English is therefore the only
 * language that needs no hint, and is left as plain text.
 *
 * For anything else the hint is load-bearing rather than cosmetic. Probed with
 * a three-sentence Tamil passage: sent plain, the endpoint returns 576 bytes of
 * near-silence; sent wrapped, 39 KB of correctly voiced audio. A well-formed
 * `<speak><lang>` wrapper does *not* work — the endpoint wants the bare
 * element, and rejects the document form the same way.
 */
const withLanguageHint = (text: string, lang: string): string => {
  const normalized = lang.toLowerCase().split("-")[0];
  if (!normalized || normalized === "en") return text;
  return `<lang xml:lang="${normalized}">${escapeXmlText(text)}</lang>`;
};

export async function tts(
  text: string,
  lang: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
): Promise<SpeechAttempt> {
  if (signal.aborted || !text || !text.trim()) {
    return { result: null, status: null };
  }

  const resolvedVoice =
    voice && WITAI_VOICES.has(voice) ? voice : WITAI_VOICE_POOL.default[0];

  // Not rotated. The synthesis endpoint accepts only the English key, so every
  // other key in the pool is a guaranteed 400 that rotation would walk past one
  // at a time — about 66 wasted requests per call, against a 240/min budget
  // shared with dictation. `getWitSecretKey` looks up the language it is given,
  // so asking for "EN" twice also rules out borrowing another language's key,
  // and a missing English key skips synthesis rather than trying a substitute.
  // Dictation still rotates: there the per-language keys are the whole mechanism.
  const witKey = sanitizeKey(await getWitSecretKey(env, "EN", "EN"));
  if (!witKey) {
    logger.warn("[witai:tts] Skipping: no English Wit key in the environment");
    return { result: null, status: null };
  }

  try {
    const response = await fetchWithTimeout(
      WITAI_SYNTH_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${witKey}`,
          Accept: "audio/mpeg",
          // The endpoint rejects form encoding outright with
          // `unsupported-content-type`, and ignores `fformat` on the JSON body —
          // `Accept` is what actually selects the container.
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: withLanguageHint(text, lang),
          voice: resolvedVoice,
          style: "default",
          speed: "100",
          pitch: "100",
        }),
      },
      TIMEOUT_FAST,
      signal,
    );

    if (!response.ok) {
      const status = response.status;
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

    const bytes = new Uint8Array(await response.arrayBuffer());
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
