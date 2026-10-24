import { detectAll as tinyldDetectAll } from "tinyld/light";
import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { d1GetLang, d1PutLang } from "@/services/d1-cache";
import {
  isProviderDegraded,
  reportProviderNeutral,
  reportProviderOutcome,
} from "@/services/health";
import { witDetectLanguage } from "@/providers/witai";
import { hashKey } from "@/utils/keys";

const CACHE_TTL = 86_400 * 30;
// Low-confidence guesses are cached briefly so a recovered Wit can correct them.
const LOW_CONFIDENCE_CACHE_TTL = 3_600;
const MAX_CHARS = 2_000;
const SHORT_TEXT_THRESHOLD = 10;
const CONFIDENCE_GAP = 0.15;
const FRANC_MAX_CHARS = 200;
// Below this there is not enough signal for a network round trip.
const WIT_MIN_CHARS = 3;
// Separate circuit from dictation so one outage cannot trip the other.
const WIT_LANG_PROVIDER = "witai-language";
// Skip text with no letters; Wit cannot classify it either.
const HAS_LETTERS = /\p{L}/u;

function normalizeLangCode(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] || "";
}

// Returns a language code only for an unambiguous script, else "". Never falls
// back to "en", which would mislabel every unknown clip.
function detectWithUnicode(text: string): string {
  if (!text.trim()) return "";

  let cjk = 0,
    kana = 0,
    cyrillic = 0,
    arabic = 0,
    devanagari = 0,
    hangul = 0,
    thai = 0,
    bengali = 0,
    gurmukhi = 0,
    gujarati = 0,
    tamil = 0,
    telugu = 0,
    kannada = 0,
    malayalam = 0,
    sinhala = 0,
    myanmar = 0,
    total = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (!code) continue;
    total++;
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else if (code >= 0x3040 && code <= 0x30ff) kana++;
    else if (code >= 0xac00 && code <= 0xd7af) hangul++;
    else if (code >= 0x0400 && code <= 0x04ff) cyrillic++;
    else if (code >= 0x0600 && code <= 0x06ff) arabic++;
    else if (code >= 0x0900 && code <= 0x097f) devanagari++;
    else if (code >= 0x0e00 && code <= 0x0e7f) thai++;
    else if (code >= 0x0980 && code <= 0x09ff) bengali++;
    else if (code >= 0x0a00 && code <= 0x0a7f) gurmukhi++;
    else if (code >= 0x0a80 && code <= 0x0aff) gujarati++;
    else if (code >= 0x0b80 && code <= 0x0bff) tamil++;
    else if (code >= 0x0c00 && code <= 0x0c7f) telugu++;
    else if (code >= 0x0c80 && code <= 0x0cff) kannada++;
    else if (code >= 0x0d00 && code <= 0x0d7f) malayalam++;
    else if (code >= 0x0d80 && code <= 0x0dff) sinhala++;
    else if (code >= 0x1000 && code <= 0x109f) myanmar++;
  }

  if (total === 0) return "";

  const pct = (n: number): number => n / total;

  if (pct(hangul) > 0.3) return "ko";
  if (pct(thai) > 0.3) return "th";
  if (pct(kana) > 0.3) return "ja";
  if (pct(cjk + hangul) > 0.5) return pct(kana) > 0.02 ? "ja" : "zh";
  if (pct(cyrillic) > 0.5) return "ru";
  if (pct(arabic) > 0.5) return "ar";
  if (pct(devanagari) > 0.5) return "hi";
  if (pct(bengali) > 0.5) return "bn";
  if (pct(gurmukhi) > 0.5) return "pa";
  if (pct(gujarati) > 0.5) return "gu";
  if (pct(tamil) > 0.5) return "ta";
  if (pct(telugu) > 0.5) return "te";
  if (pct(kannada) > 0.5) return "kn";
  if (pct(malayalam) > 0.5) return "ml";
  if (pct(sinhala) > 0.5) return "si";
  if (pct(myanmar) > 0.5) return "my";
  return "";
}

interface LocalDetection {
  lang: string;
  /** True when local evidence is strong enough to skip the remote check. */
  confident: boolean;
}

// Offline stage; null when there is no candidate.
function detectLocal(text: string): LocalDetection | null {
  const unicodeLang = detectWithUnicode(text);

  if (text.length < SHORT_TEXT_THRESHOLD) {
    return unicodeLang ? { lang: unicodeLang, confident: true } : null;
  }

  try {
    // tinyld returns ISO 639-1 directly; empty array when undecided.
    const ranked = tinyldDetectAll(text);
    const top = ranked[0];
    const topLang = top?.lang ?? null;
    const gap = top ? top.accuracy - (ranked[1]?.accuracy ?? 0) : 0;

    if (topLang && gap >= CONFIDENCE_GAP) {
      return { lang: topLang, confident: true };
    }
    if (topLang && unicodeLang && topLang === unicodeLang) {
      return { lang: topLang, confident: true };
    }
    if (unicodeLang) {
      return { lang: unicodeLang, confident: true };
    }
    if (topLang) {
      return { lang: topLang, confident: false };
    }
    return null;
  } catch {
    return unicodeLang ? { lang: unicodeLang, confident: true } : null;
  }
}

// Remote stage: Wit's `/language`, only when local is unsure; failures degrade
// to null so the caller keeps the local guess.
async function detectWithWit(
  text: string,
  env: Env,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) return null;
  if (text.length < WIT_MIN_CHARS) return null;
  if (!HAS_LETTERS.test(text)) return null;
  if (await isProviderDegraded(env, WIT_LANG_PROVIDER)) return null;

  try {
    const detected = await witDetectLanguage(text, env, signal);
    if (detected) {
      await reportProviderOutcome(env, WIT_LANG_PROVIDER, true);
      return detected;
    }
    // A reachable Wit with no usable locale is not a provider failure.
    reportProviderNeutral(WIT_LANG_PROVIDER);
    return null;
  } catch (err) {
    await reportProviderOutcome(env, WIT_LANG_PROVIDER, false);
    logger.warn("[autoDetect] Wit language fallback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function detectTextLanguage(
  text: string,
  env: Env,
  signal: AbortSignal,
): Promise<string> {
  if (!text?.trim() || signal.aborted) return "";

  const input = text.slice(0, MAX_CHARS);

  const local = detectLocal(input);
  if (local?.confident) {
    const key = `auto:${await hashKey(input)}`;
    d1PutLang(env.DB, key, local.lang, CACHE_TTL).catch(() => {});
    return local.lang;
  }

  const key = `auto:${await hashKey(input)}`;
  const fromCache = await d1GetLang(env.DB, key);
  if (fromCache) return fromCache;

  if (signal.aborted) return "";

  const remote = await detectWithWit(input, env, signal);
  if (remote) {
    await d1PutLang(env.DB, key, remote, CACHE_TTL);
    return remote;
  }

  if (local) {
    await d1PutLang(env.DB, key, local.lang, LOW_CONFIDENCE_CACHE_TTL);
    return local.lang;
  }

  return "";
}

export function validateTranscriptLanguage(
  text: string,
  detectedLang: string | undefined,
): boolean {
  if (!text || !detectedLang || text.length < SHORT_TEXT_THRESHOLD) return true;

  try {
    const ranked = tinyldDetectAll(text.slice(0, FRANC_MAX_CHARS));
    const top = ranked[0];
    if (!top) return true;

    const gap = top.accuracy - (ranked[1]?.accuracy ?? 0);
    if (gap < CONFIDENCE_GAP) return true;

    // No top result leaves nothing to compare against.
    const topLang = top.lang;
    const match = topLang === normalizeLangCode(detectedLang);
    if (!match) {
      logger.warn("[autoDetect] Transcript language mismatch", {
        provider: detectedLang,
        tinyld: topLang,
        gap,
        textSnippet: text.substring(0, 80),
      });
    }
    return match;
  } catch {
    return true;
  }
}
