import { WORKER_ERROR_CODES, TTS_MAX_TEXT_CHARS, ttsRequestSchema } from "@ekwe/shared";
import { logger } from "../core/logger";
import { getTtsProviderNames, ttsProviderSupports } from "../core/config";
import * as gemini from "../providers/gemini";
import * as deepgram from "../providers/deepgram";
import * as cloudflare from "../providers/cloudflare";
import { guardLanguageCode, safeParseJSON } from "../core/guards";
import { sanitizeTranslationText } from "../core/sanitize";
import { hashKey } from "../utils/keys";
import { Env, Tier, TtsAttempt } from "../core/types";

/**
 * Premium text-to-speech.
 *
 * Gate model: `/tts` is PREMIUM-only. FREE tier (including a throttled
 * PREMIUM user downgraded for the day) gets a 403 and the app falls back to
 * on-device speech. TTS is not a daily-quota draw, so there is no preflight
 * usage gate here — the tier check IS the gate.
 *
 * Voice selection: the client sends `gender: "male" | "female"`. The worker
 * tries the 3 curated best voices for that gender under the current provider.
 * If all 3 fail, it moves to the next provider and repeats. MeloTTS has no
 * voice parameter and is tried last with its fixed voice.
 */

// Hard ceiling for the whole provider failover loop. The mobile client gives
// TTS 25s before falling back to on-device speech, so this must stay under it.
const TTS_PIPELINE_TOTAL_MS = 20_000;
const TTS_CACHE_TTL_SECONDS = 24 * 60 * 60;
// KV values cap at 25MB; skip caching anything near that. ~2MB covers ~40s
// of 24kHz WAV while keeping the stored base64 well under the limit.
const TTS_CACHE_MAX_BYTES = 2 * 1024 * 1024;
// 23h so the flag reliably expires before the next UTC midnight even with
// KV-wide clock skew; the date is in the key so old flags can never leak.
const TTS_DOWN_TTL_SECONDS = 23 * 60 * 60;

// ─── KV binary cache format ──────────────────────────────────────
// Layout: [2B mime_len][2B provider_len][mime UTF-8][provider UTF-8][audio bytes]
// This eliminates the ~33% base64 overhead of the old JSON+base64 format.
function packTtsCache(mime: string, provider: string, audio: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const mimeBytes = enc.encode(mime);
  const providerBytes = enc.encode(provider);
  const buf = new ArrayBuffer(4 + mimeBytes.length + providerBytes.length + audio.byteLength);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  view.setUint16(0, mimeBytes.length, true);
  view.setUint16(2, providerBytes.length, true);

  let offset = 4;
  u8.set(mimeBytes, offset);
  offset += mimeBytes.length;
  u8.set(providerBytes, offset);
  offset += providerBytes.length;
  u8.set(audio, offset);

  return new Uint8Array(buf);
}

function unpackTtsCache(buf: ArrayBuffer): { mime: string; provider: string; audio: Uint8Array } | null {
  if (buf.byteLength < 4) return null;
  const view = new DataView(buf);
  const mimeLen = view.getUint16(0, true);
  const providerLen = view.getUint16(2, true);
  const headerLen = 4 + mimeLen + providerLen;
  if (buf.byteLength < headerLen) return null;

  const dec = new TextDecoder();
  const u8 = new Uint8Array(buf);
  const mime = dec.decode(u8.slice(4, 4 + mimeLen));
  const provider = dec.decode(u8.slice(4 + mimeLen, headerLen));
  const audio = new Uint8Array(buf.slice(headerLen));

  if (mime.length === 0 || provider.length === 0 || audio.byteLength === 0) return null;
  return { mime, provider, audio };
}

// ─── Curated Voice Lists ─────────────────────────────────────────
// 3 best voices per gender per provider. Researched from official docs:
// Gemini: 30 voices (voiceConfig.prebuiltVoiceConfig.voiceName)
// Aura2 EN: 40 speakers, Aura2 ES: 10 speakers (speaker param)
// Aura1: 12 speakers (speaker param)
// MeloTTS: no voice param (fixed voice)
const VOICE_LISTS: Record<
  string,
  { male: readonly string[]; female: readonly string[] }
> = {
  gemini: {
    male: ["Puck", "Charon", "Fenrir"],
    female: ["Zephyr", "Kore", "Leda"],
  },
  aura2: {
    male: ["orion", "apollo", "zeus"],
    female: ["helena", "luna", "asteria"],
  },
  aura1: {
    male: ["orion", "orpheus", "angus"],
    female: ["athena", "luna", "asteria"],
  },
  melotts: {
    male: [""],
    female: [""],
  },
};

type TtsFn = (
  text: string,
  lang: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
) => Promise<TtsAttempt>;

const TTS_PROVIDER_MODULES: Record<string, TtsFn> = {
  gemini: (text, _lang, env, signal, voice) =>
    gemini.tts(text, env, signal, voice),
  aura2: (text, lang, env, _signal, voice) =>
    deepgram.aura2(text, lang as "en" | "es", env, voice),
  aura1: (text, _lang, env, _signal, voice) =>
    deepgram.aura1(text, env, voice),
  melotts: (text, _lang, env, _signal) => cloudflare.melotts(text, _lang, env),
};

function ttsDownKey(provider: string, date: string): string {
  return `tts:down:${provider}:${date}`;
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function isTtsProviderDown(env: Env, provider: string): Promise<boolean> {
  return !!(await env.EKWE_KV.get(ttsDownKey(provider, utcDate())));
}

async function markTtsProviderDown(env: Env, provider: string): Promise<void> {
  const date = utcDate();
  await env.EKWE_KV.put(ttsDownKey(provider, date), "1", {
    expirationTtl: TTS_DOWN_TTL_SECONDS,
  });
  logger.warn(`[tts] Marked "${provider}" down for UTC ${date}`);
}

function ttsAudioResponse(
  mime: string,
  audio: Uint8Array,
  provider: string,
  fromCache: boolean,
): Response {
  return new Response(audio as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, no-store",
      "X-TTS-Provider": provider,
      "X-TTS-Cache": fromCache ? "HIT" : "MISS",
    },
  });
}

/**
 * Try a single provider with the curated voice list for the requested gender.
 * Iterates through the 3 curated voices; returns the first successful result,
 * or the last attempt (carrying its HTTP status) when all voices fail so the
 * caller can detect exhaustion signals like 429/403.
 */
async function tryProviderVoices(
  provider: string,
  text: string,
  lang: string,
  gender: "male" | "female",
  env: Env,
  signal: AbortSignal,
): Promise<TtsAttempt | null> {
  const voices = VOICE_LISTS[provider]?.[gender];
  if (!voices) return null;

  const fn = TTS_PROVIDER_MODULES[provider];
  if (!fn) return null;

  let last: TtsAttempt | null = null;

  for (const voice of voices) {
    if (signal.aborted) return null;

    // MeloTTS has no voice param — call once without voice and return
    if (provider === "melotts") {
      const att = await fn(text, lang, env, signal);
      if (att.result) return att;
      last = att;
      continue;
    }

    logger.info(`[tts] Trying ${provider} voice="${voice}" (${gender})`);
    const att = await fn(text, lang, env, signal, voice);
    if (att.result) return att;

    // Exhaustion signals (429/403) are the meaningful failure to surface —
    // a key blacklist often turns the *following* voice attempts into
    // status-less failures, so keep the last 429/403 we saw.
    if (att.status === 429 || att.status === 403) {
      last = att;
    } else if (!last || last.status === null) {
      last = att;
    }

    // Log failed voice attempt but continue to next voice
    logger.info(`[tts] ${provider} voice="${voice}" failed`, {
      status: att.status,
    });
  }
  return last;
}

export async function handleTts(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  if (tier !== "PREMIUM") {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.PREMIUM_FEATURE_REQUIRED,
        message: "Premium text-to-speech requires an active Premium plan.",
      },
      { status: 403 },
    );
  }

  const parsedJson = await safeParseJSON<unknown>(request);
  if (!parsedJson.ok) return parsedJson.response;
  const parsed = ttsRequestSchema.safeParse(parsedJson.data);
  if (!parsed.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.lang === "auto") {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.INVALID_TARGET_LANGUAGE,
        message: "A concrete language is required.",
      },
      { status: 400 },
    );
  }
  const langGuard = guardLanguageCode(body.lang, "lang");
  if (!langGuard.allowed) return langGuard.response;
  const lang = body.lang;

  if (!body.text.trim()) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }

  const cleanText = sanitizeTranslationText(body.text);
  if (!cleanText) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }
  if (cleanText.length > TTS_MAX_TEXT_CHARS) {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.TEXT_TOO_LONG,
        message: `Speech is limited to ${TTS_MAX_TEXT_CHARS} characters.`,
      },
      { status: 413 },
    );
  }

  const gender: "male" | "female" = body.gender ?? "female";

  // KV cache by (language, text-hash, gender). Gender is part of the key so
  // male/female requests for the same text don't collide.
  let cacheKey: string | null = null;
  try {
    cacheKey = `tts:${body.lang}:${gender}:${await hashKey(cleanText)}`;
    const cached = await env.EKWE_KV.get(cacheKey, { type: "arrayBuffer" });
    if (cached) {
      try {
        const hit = unpackTtsCache(cached);
        if (hit) {
          logger.info(`[tts] KV cache hit (${hit.provider})`);
          return ttsAudioResponse(
            hit.mime,
            hit.audio,
            hit.provider,
            true,
          );
        }
      } catch {
        // Corrupt cache value → fall through and regenerate.
      }
    }
  } catch (err) {
    logger.error(`[tts] KV cache lookup error`, { error: String(err) });
  }

  // ─── Voice-selection failover loop ─────────────────────────────
  // For each provider in priority order: try its 3 curated voices for the
  // requested gender. If all 3 fail (or the provider is down), move to the
  // next provider. MeloTTS is last with no voice selection.
  const providers = getTtsProviderNames();
  const now = Date.now();
  const totalMs = TTS_PIPELINE_TOTAL_MS;

  for (const provider of providers) {
    const remainingMs = totalMs - (Date.now() - now);
    if (remainingMs <= 0) break;

    // Skip downed providers
    if (await isTtsProviderDown(env, provider)) {
      logger.info(`[tts] Skipping "${provider}": marked down for today`);
      continue;
    }

    // Skip providers that don't support the requested language
    if (!ttsProviderSupports(provider, lang)) continue;

    if (signal.aborted) throw new Error("CLIENT_ABORTED");

    try {
      const att = await tryProviderVoices(
        provider,
        cleanText,
        lang,
        gender,
        env,
        signal,
      );

      if (att?.result) {
        // Cache the result as raw binary (no base64 overhead)
        if (cacheKey && att.result.audio.byteLength <= TTS_CACHE_MAX_BYTES) {
          try {
            const packed = packTtsCache(
              att.result.mime,
              att.result.provider,
              att.result.audio,
            );
            await env.EKWE_KV.put(cacheKey, packed, {
              expirationTtl: TTS_CACHE_TTL_SECONDS,
            });
          } catch (err) {
            logger.error(`[tts] KV cache write error`, { error: String(err) });
          }
        }

        return ttsAudioResponse(
          att.result.mime,
          att.result.audio,
          att.result.provider,
          false,
        );
      }

      // All voices for this provider failed — check if it was a quota issue
      // to mark the provider down for the day
      if (att?.status === 429 || att?.status === 403) {
        await markTtsProviderDown(env, provider);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "CLIENT_ABORTED") throw e;
      logger.error(`[tts] ${provider} failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json(
    {
      error: WORKER_ERROR_CODES.TTS_UNAVAILABLE,
      message:
        "Speech generation is temporarily unavailable. Please try again shortly.",
    },
    { status: 503 },
  );
}
