import { logger } from "@/core/logger";
import { STREAM_CHUNK_MS } from "@ekwe/shared";
import { isSupportedLanguage } from "@ekwe/shared/languages";
import type { StreamRoute } from "@ekwe/shared/languageCapabilities";
import {
  Env,
  CLIENT_ABORTED,
  TranscribeResult,
  SpeechAttempt,
} from "@/core/types";
import { rotateKeysOrThrow, sanitizeKey } from "@/utils/keys";
import {
  ProviderHttpError,
  ProviderUnusableError,
} from "@/core/provider-errors";
import { WITAI_MIN_SPEECH_BYTES } from "@ekwe/shared/providerLimits";
import { getWitSecretKey } from "@/utils/wit-keys";
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
const WITAI_LANGUAGE_URL = "https://api.wit.ai/language?v=20240304";

// Require both confidence and support: Wit also names languages we do not sell.
const WIT_DETECT_CONFIDENCE_MIN = 0.6;
const WIT_DETECT_MAX_CHARS = 280;
// Tighter than a normal provider call (TIMEOUT_FAST is 15s).
const WIT_DETECT_TIMEOUT_MS = 2_500;

/** Detect `text`'s language via Wit's `/language`, or `null` if unsure. */
export async function witDetectLanguage(
  text: string,
  env: Env,
  signal: AbortSignal,
): Promise<string | null> {
  const q = text.trim().slice(0, WIT_DETECT_MAX_CHARS);
  if (!q) return null;

  const url = `${WITAI_LANGUAGE_URL}&n=3&q=${encodeURIComponent(q)}`;
  const res = await rotateKeysOrThrow(
    env,
    "WIT_KEY_",
    "witai",
    (key) =>
      fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${key}`,
            "User-Agent": getUserAgent(),
          },
        },
        WIT_DETECT_TIMEOUT_MS,
        signal,
      ),
    signal,
  );

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const locales = (body as { detected_locales?: unknown })?.detected_locales;
  if (!Array.isArray(locales)) return null;

  for (const entry of locales) {
    const locale = (entry as { locale?: unknown })?.locale;
    const confidence = (entry as { confidence?: unknown })?.confidence;
    if (typeof locale !== "string" || typeof confidence !== "number") continue;
    if (confidence < WIT_DETECT_CONFIDENCE_MIN) continue;

    const code = locale.trim().toLowerCase().split(/[-_]/)[0];
    if (isSupportedLanguage(code)) return code;
  }

  return null;
}

function subarray(bytes: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Wit parses Vorbis-in-Ogg only; its identification packet is `\x01vorbis`.
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
  const witKey = sanitizeKey(getWitSecretKey(env, targetLang, baseLang));

  // A credential gap, not a provider failure — but it must still be visible,
  // so it throws rather than returning a null indistinguishable from "declined".
  if (!witKey) {
    throw new ProviderUnusableError(
      "witai",
      `no API key for language ${lang} (looked for ${targetLang} and ${baseLang})`,
    );
  }

  const contentType = toWitMime(blob.type);
  if (!contentType) {
    throw new ProviderUnusableError(
      "witai",
      `unsupported container type ${blob.type}`,
    );
  }

  if (contentType === "audio/ogg" && !(await isOggVorbis(blob))) {
    // Detected here rather than downstream, because a silent empty result is
    // indistinguishable from a recording of silence.
    const isOpus = await isOggOpus(blob);
    throw new ProviderUnusableError(
      "witai",
      `Ogg container holds ${isOpus ? "Opus" : "an unrecognised codec"}; /dictation parses Vorbis only`,
    );
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
    throw new ProviderHttpError("witai", res.status, await safeText(res));
  }

  const data = await parseStream(res);
  if (!data?.text) {
    // Wit does return 200 with nothing for audio it cannot parse. The planner
    // gates on duration first, so reaching here means the clip was in range.
    logger.warn("[witai] Empty transcript");
    return null;
  }
  if (isHallucination(data.text)) {
    logger.warn("[witai] Transcript discarded as hallucination");
    return null;
  }

  return { text: data.text, provider: "witai", language: lang };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function parseStream(res: Response): Promise<{ text: string } | null> {
  const raw = await res.text();
  return parseJsonStream(raw);
}

/**
 * Wit's dictation is a chunked POST answered with newline-delimited JSON, so it
 * is the only route needing a RIFF header. No auto-detection: one key per language.
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
  const witKey = sanitizeKey(getWitSecretKey(env, targetLang, baseLang));
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

/** First/last token timestamp (ms) for a dictation object, or -1 when absent. */
function tokenSpan(speech: { tokens?: unknown } | undefined): [number, number] {
  const tokens = speech?.tokens;
  if (!Array.isArray(tokens)) return [-1, -1];
  let start = Infinity;
  let end = -Infinity;
  for (const token of tokens) {
    const s = (token as { start?: unknown })?.start;
    const e = (token as { end?: unknown })?.end;
    if (typeof s === "number") start = Math.min(start, s);
    if (typeof e === "number") end = Math.max(end, e);
  }
  return start === Infinity ? [-1, -1] : [start, end];
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

  // Dictation is newline-delimited JSON with one FINAL_TRANSCRIPTION per
  // segment; the *last* object is not always the full clip (Wit re-runs a tail
  // as its own segment). Every final is committed speech, so real, time-distinct
  // finals must be concatenated. The same time span re-finalized is a
  // refinement, not a new utterance -- pop anything the new final overlaps,
  // then append.
  const segments: Array<{ start: number; end: number; text: string }> = [];
  for (const obj of parts) {
    const trimmed = obj.replace(/\r$/, "").trim();
    if (!trimmed) continue;
    let parsed: {
      text?: unknown;
      is_final?: unknown;
      type?: unknown;
      speech?: { tokens?: unknown };
    };
    try {
      prev += trimmed;
      parsed = JSON.parse(prev) as {
        text?: unknown;
        is_final?: unknown;
        type?: unknown;
        speech?: { tokens?: unknown };
      };
      prev = "";
    } catch {
      continue;
    }
    // Canonical marker per Wit's SDKs is `is_final`; the live endpoint also
    // sends `type: "FINAL_TRANSCRIPTION"`. Accept either.
    const isFinal =
      parsed.is_final === true || parsed.type === "FINAL_TRANSCRIPTION";
    if (!isFinal) continue;
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) continue;

    const [start, end] = tokenSpan(parsed.speech);
    const seg = { start, end, text };
    while (
      segments.length &&
      start !== -1 &&
      end !== -1 &&
      segments[segments.length - 1].start <= end &&
      segments[segments.length - 1].end >= start
    ) {
      segments.pop();
    }
    segments.push(seg);
  }

  const result = segments.length
    ? segments.map((seg) => seg.text).join(" ")
    : last?.text;
  if (!result?.trim()) return null;

  logger.info("[witai] Final transcript", {
    text: result.trim().substring(0, 100),
  });
  return { text: result.trim() };
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
 * Index 0 is the Clear voice, index 1 the Warm voice; one list per gender serves
 * every locale. Only these four names are enabled — an unassigned Wit free-tier
 * voice fails outright, and three such attempts trip the circuit for the pool.
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
  const witKey = sanitizeKey(getWitSecretKey(env, "EN", "EN"));
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
          q: text,
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
    // Wit answers 200 with a few hundred bytes for a script it cannot speak —
    // Hindi, Thai, Tamil and Telugu all come back as the identical 576-byte
    // payload, which is silence rather than speech. Passing that through would
    // cache and serve audio that plays nothing, so it is treated as a miss and
    // the pool moves on. Every real utterance measured well above this floor.
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength < WITAI_MIN_SPEECH_BYTES ||
      bytes.byteLength > MAX_SPEECH_BYTES
    ) {
      logger.warn("[witai:tts] Output unusable", {
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
