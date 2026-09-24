import { VOICE_PREVIEW_TEXT } from "@ekwe/shared";
import { logger } from "@/core/logger";
import {
  SPEECH_CACHE_TTL_SECONDS,
  SPEECH_DOWN_TTL_SECONDS,
  SPEECH_KV_CACHE_MAX_BYTES,
  SPEECH_R2_CACHE_MAX_BYTES,
  SPEECH_R2_CACHE_TTL_SECONDS,
} from "@/core/budgets";
import {
  getProviderModule,
  getProviderNamesFor,
  providerSupportsLanguage,
} from "@/providers";
import { hashKey } from "@/utils/keys";
import { recordSpeechCacheEvent } from "@/utils/analytics";
import { Env, Tier, SpeechGender, SpeechAttempt } from "@/core/types";
import { runProviderFailover } from "@/utils/retry";
import { isProviderDegraded, reportProviderOutcome } from "@/services/health";

const R2_EXPIRES_AT_META = "expiresAt";

function packSpeechCache(
  mime: string,
  provider: string,
  audio: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const mimeBytes = enc.encode(mime);
  const providerBytes = enc.encode(provider);
  const buf = new ArrayBuffer(
    4 + mimeBytes.length + providerBytes.length + audio.byteLength,
  );
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

function unpackSpeechCache(
  buf: ArrayBuffer,
): { mime: string; provider: string; audio: Uint8Array } | null {
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

  if (mime.length === 0 || provider.length === 0 || audio.byteLength === 0)
    return null;
  return { mime, provider, audio };
}

export interface SpeechResult {
  mime: string;
  provider: string;
  audio: Uint8Array;
}

export async function buildSpeechCacheKey(
  text: string,
  lang: string,
  gender: string,
  voiceId: string | undefined,
  userId: string,
  tier: "FREE" | "PREMIUM" = "FREE",
): Promise<string> {
  return `speech:${await hashKey(userId)}:${voiceId ?? "standard"}:${gender}:${tier.toLowerCase()}:cache:${lang}:${await hashKey(text)}`;
}

export async function readSpeechCache(
  env: Env,
  cacheKey: string,
): Promise<SpeechResult | null> {
  const kvHit = await readKvSpeechCache(env, cacheKey);
  if (kvHit) {
    recordSpeechCacheEvent(env, "hit", "kv");
    return kvHit;
  }

  const r2Hit = await readR2SpeechCache(env, cacheKey);
  if (r2Hit) {
    recordSpeechCacheEvent(env, "hit", "r2");
    return r2Hit;
  }

  recordSpeechCacheEvent(env, "miss", "none");
  return null;
}

async function readKvSpeechCache(
  env: Env,
  cacheKey: string,
): Promise<SpeechResult | null> {
  try {
    const cached = await env.EKWE_KV.get(cacheKey, { type: "arrayBuffer" });
    if (cached) {
      try {
        const hit = unpackSpeechCache(cached);
        if (hit) {
          logger.info(`[speech] KV cache hit (${hit.provider})`);
          return hit;
        }
      } catch {
        // Corrupt cache value → fall through and check R2 / regenerate.
      }
    }
  } catch (err) {
    logger.error(`[speech] KV cache lookup error`, { error: String(err) });
  }
  return null;
}

async function readR2SpeechCache(
  env: Env,
  cacheKey: string,
): Promise<SpeechResult | null> {
  const bucket = env.SPEECH_CACHE;
  if (!bucket) return null;
  try {
    const obj = await bucket.get(cacheKey);
    if (!obj) return null;

    const expiresAt = Number(obj.customMetadata?.[R2_EXPIRES_AT_META] ?? 0);
    if (expiresAt > 0 && expiresAt < Math.floor(Date.now() / 1000)) {
      await bucket.delete(cacheKey).catch(() => {});
      logger.info(`[speech] R2 cache entry expired, deleted: ${cacheKey}`);
      return null;
    }

    const mime = String(obj.customMetadata?.mime ?? "");
    const provider = String(obj.customMetadata?.provider ?? "");
    const audio = new Uint8Array(await obj.arrayBuffer());
    if (!mime || !provider || audio.byteLength === 0) return null;

    logger.info(`[speech] R2 cache hit (${provider})`);
    return { mime, provider, audio };
  } catch (err) {
    logger.error(`[speech] R2 cache lookup error`, { error: String(err) });
    return null;
  }
}

export async function writeSpeechCache(
  env: Env,
  cacheKey: string,
  result: SpeechResult,
): Promise<void> {
  if (result.audio.byteLength <= SPEECH_KV_CACHE_MAX_BYTES) {
    await writeKvSpeechCache(env, cacheKey, result);
    return;
  }
  if (result.audio.byteLength > SPEECH_R2_CACHE_MAX_BYTES) return;
  await writeR2SpeechCache(env, cacheKey, result);
}

async function writeKvSpeechCache(
  env: Env,
  cacheKey: string,
  result: SpeechResult,
): Promise<void> {
  try {
    const packed = packSpeechCache(result.mime, result.provider, result.audio);
    await env.EKWE_KV.put(cacheKey, packed, {
      expirationTtl: SPEECH_CACHE_TTL_SECONDS,
    });
    recordSpeechCacheEvent(env, "write", "kv");
  } catch (err) {
    logger.error(`[speech] KV cache write error`, { error: String(err) });
  }
}

async function writeR2SpeechCache(
  env: Env,
  cacheKey: string,
  result: SpeechResult,
): Promise<void> {
  const bucket = env.SPEECH_CACHE;
  if (!bucket) return;
  try {
    const expiresAt =
      Math.floor(Date.now() / 1000) + SPEECH_R2_CACHE_TTL_SECONDS;
    await bucket.put(cacheKey, new Uint8Array(result.audio), {
      customMetadata: {
        mime: result.mime,
        provider: result.provider,
        [R2_EXPIRES_AT_META]: String(expiresAt),
      },
    });
    recordSpeechCacheEvent(env, "write", "r2");
  } catch (err) {
    logger.error(`[speech] R2 cache write error`, { error: String(err) });
  }
}

export function resolveEffectiveLang(
  text: string,
  lang: string,
): { isPreview: boolean; effectiveLang: string } {
  const isPreview = text === VOICE_PREVIEW_TEXT;
  return { isPreview, effectiveLang: isPreview ? "en" : lang };
}

export function resolveProviderVoices(
  provider: string,
  lang: string,
  gender: SpeechGender,
  voiceId: string | undefined,
): string[] {
  const langCode = lang.split("-")[0].toLowerCase();
  return getProviderModule(provider)?.voice?.(voiceId, langCode, gender) ?? [];
}

function voiceHonorsId(
  provider: string,
  voiceId: string,
  gender: SpeechGender,
): boolean {
  const voice = getProviderModule(provider)?.voice;
  if (!voice) return false;
  const without = voice(undefined, "en", gender);
  const withId = voice(voiceId, "en", gender);
  if (withId.length === 0) return false;
  if (without.length !== withId.length) return true;
  return without.some((v, i) => v !== withId[i]);
}

function orderVoicePreferred(
  providers: readonly string[],
  voiceId: string | undefined,
  gender: SpeechGender,
): readonly string[] {
  const preference = voiceId ?? "standard";
  if (preference === "standard") return providers;
  return [...providers].sort(
    (a, b) =>
      Number(voiceHonorsId(b, preference, gender)) -
      Number(voiceHonorsId(a, preference, gender)),
  );
}

function speechDownKey(provider: string, date: string): string {
  return `speech:down:${provider}:${date}`;
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function isSpeechProviderDown(
  env: Env,
  provider: string,
): Promise<boolean> {
  return !!(await env.EKWE_KV.get(speechDownKey(provider, utcDate())));
}

async function markSpeechProviderDown(
  env: Env,
  provider: string,
): Promise<void> {
  const date = utcDate();
  await env.EKWE_KV.put(speechDownKey(provider, date), "1", {
    expirationTtl: SPEECH_DOWN_TTL_SECONDS,
  });
  logger.warn(`[speech] Marked "${provider}" down for UTC ${date}`);
}

async function tryProviderVoices(
  provider: string,
  text: string,
  lang: string,
  gender: SpeechGender,
  voiceId: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<SpeechAttempt | null> {
  const voices = resolveProviderVoices(provider, lang, gender, voiceId);
  if (!voices || voices.length === 0) return null;

  const fn = getProviderModule(provider)?.tts;
  if (!fn) return null;

  let last: SpeechAttempt | null = null;

  for (const voice of voices) {
    if (signal.aborted) return null;

    logger.info(`[speech] Trying ${provider} voice="${voice}" (${gender})`);
    const att = await fn(text, lang, env, signal, voice);
    if (att.result) return att;

    if (att.status === 429 || att.status === 503) {
      last = att;
    } else if (!last || last.status === null) {
      last = att;
    }

    logger.info(`[speech] ${provider} voice="${voice}" failed`, {
      status: att.status,
    });
  }
  return last;
}

export interface SpeechSynthOptions {
  text: string;
  lang: string;
  gender: SpeechGender;
  voiceId: string | undefined;
  tier: Tier;
  env: Env;
  signal: AbortSignal;
  budgetMs: number;
  cacheKey: string | null;
}

export async function runSpeechSynth(
  options: SpeechSynthOptions,
): Promise<SpeechResult | null> {
  const { text, lang, gender, voiceId, tier, env, signal, budgetMs, cacheKey } =
    options;

  const providers = orderVoicePreferred(
    getProviderNamesFor("tts", tier),
    voiceId,
    gender,
  );

  const result = await runProviderFailover<SpeechAttempt>({
    providers,
    signal,
    totalMs: budgetMs,
    route: "speech",
    env,
    tier,
    shouldSkip: async (provider) => {
      if (await isSpeechProviderDown(env, provider)) {
        logger.info(`[speech] Skipping "${provider}": marked down for today`);
        return true;
      }
      if (await isProviderDegraded(env, provider)) {
        logger.info(`[speech] Skipping "${provider}" (circuit open)`);
        return true;
      }
      return !providerSupportsLanguage(provider, "tts", lang);
    },
    invoke: (provider, attemptSignal) =>
      tryProviderVoices(
        provider,
        text,
        lang,
        gender,
        voiceId,
        env,
        attemptSignal,
      ),
    handleAttempt: async (provider, att) => {
      if (att?.result) {
        await reportProviderOutcome(env, provider, true);
        if (cacheKey) await writeSpeechCache(env, cacheKey, att.result);
        return true;
      }

      await reportProviderOutcome(env, provider, false);
      if (att?.status === 429 || att?.status === 503) {
        await markSpeechProviderDown(env, provider);
      }
      return false;
    },
    onAttemptError: (provider) => reportProviderOutcome(env, provider, false),
  });

  return result?.result ?? null;
}
