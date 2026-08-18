/**
 * Centralized language support definitions for all transcription providers.
 *
 * Each provider exports `supportedLanguages` — the set of ISO 639-1 codes
 * its STT API actually handles. The pipeline checks this set before calling
 * a provider, skipping it when the requested language isn't supported.
 *
 * Providers based on Whisper (Cloudflare, Groq), Gladia, and
 * AssemblyAI batch cover the full Whisper set. Providers with narrower
 * coverage (Cohere, Wit.ai, Deepgram) list their specific languages.
 */

// ─── Full Whisper language set (99 languages) ─────────────────────────
// Sourced from openai/whisper/whisper/tokenizer.py LANGUAGES dict.
// This is our "universal" set — any provider built on Whisper or claiming
// 100+ language support uses this as their supported set.
//
// Deliberately a literal, NOT derived from @ekwe/shared LANGUAGES: this is
// the Whisper tokenizer set (a strict subset of the 139-code product list),
// and deriving would over-claim languages Whisper can't transcribe (e.g.
// `ci`/`ck`). `tests/supportedLanguages.test.ts` guards that every code here
// stays present in the shared list.

export const ALL_LANGUAGES = new Set([
  "en",
  "zh",
  "de",
  "es",
  "ru",
  "ko",
  "fr",
  "ja",
  "pt",
  "tr",
  "pl",
  "ca",
  "nl",
  "ar",
  "sv",
  "it",
  "id",
  "hi",
  "fi",
  "vi",
  "he",
  "uk",
  "el",
  "ms",
  "cs",
  "ro",
  "da",
  "hu",
  "ta",
  "no",
  "nb",
  "th",
  "ur",
  "hr",
  "bg",
  "lt",
  "la",
  "mi",
  "ml",
  "cy",
  "sk",
  "te",
  "fa",
  "lv",
  "bn",
  "sr",
  "az",
  "sl",
  "kn",
  "et",
  "mk",
  "br",
  "eu",
  "is",
  "hy",
  "ne",
  "mn",
  "bs",
  "kk",
  "sq",
  "sw",
  "gl",
  "mr",
  "pa",
  "si",
  "km",
  "sn",
  "yo",
  "so",
  "af",
  "oc",
  "ka",
  "be",
  "tg",
  "sd",
  "gu",
  "am",
  "yi",
  "lo",
  "uz",
  "fo",
  "ht",
  "ps",
  "tk",
  "nn",
  "mt",
  "sa",
  "lb",
  "my",
  "bo",
  "tl",
  "mg",
  "as",
  "tt",
  "haw",
  "ln",
  "ha",
  "ba",
  "jv",
  "su",
  "yue",
]);

// ─── Provider code translation ───────────────────────────────────────
// The canonical (shared) language codes match ISO 639-1. A few providers
// use their own non-ISO codes for specific languages; translate before
// calling their APIs so the canonical code is always sent to the pipeline.
// Whisper's tokenizer (openai/whisper) uses "jw" for Javanese and "no"
// for Norwegian (Bokmål), while ISO 639-1 uses "jv" and "nb".

const WHISPER_CODE_MAP: Record<string, string> = {
  jv: "jw", // Javanese
  nb: "no", // Norwegian (Bokmål)
};

export function toWhisperCode(code: string): string {
  return WHISPER_CODE_MAP[code] ?? code;
}

// ─── Cohere Transcribe ───────────────────────────────────────────────
// Cohere's transcribe API (cohere-transcribe-03-2026) supports 14 languages.

export const COHERE_LANGUAGES = new Set([
  "en",
  "fr",
  "de",
  "it",
  "es",
  "pt",
  "el",
  "nl",
  "pl",
  "zh",
  "ja",
  "ko",
  "vi",
  "ar",
]);

// ─── Wit.ai Dictation ────────────────────────────────────────────────
// Wit.ai supports 132 languages via per-language API keys (wit.ai/faq).
// 130 have ISO 639-1 codes; Cherokee ("ci") and Sicilian ("ck") use Wit's
// own codes and are kept here so the WIT_KEY_CI / WIT_KEY_CK keys work.
// Each WIT_KEY_{LANG} in env maps to one language model.

export const WITAI_LANGUAGES = new Set([
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

// ─── Deepgram Nova-2 ─────────────────────────────────────────────────
// From Deepgram docs (developers.deepgram.com/docs/models-languages-overview):
// Nova-2 general model supports these base languages.

export const DEEPGRAM_LANGUAGES = new Set([
  "bg",
  "ca",
  "zh",
  "cs",
  "da",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "de",
  "el",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lv",
  "lt",
  "ms",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "es",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
]);

// ─── AssemblyAI Streaming ────────────────────────────────────────────
// AssemblyAI's streaming/real-time STT currently supports English only.

export const ASSEMBLYAI_STREAM_LANGUAGES = new Set(["en"]);

// ─── Provider name → language set map (used by pipeline) ─────────────
export const STREAM_STT_LANGUAGES: Record<string, ReadonlySet<string>> = {
  deepgram: DEEPGRAM_LANGUAGES,
  assemblyai: ASSEMBLYAI_STREAM_LANGUAGES,
  gladia: ALL_LANGUAGES,
  witai: WITAI_LANGUAGES,
};

// ─── Display names (shared catalog) ─────────────────────────────────
// Resolves a language code to its human-readable name for API responses.
import { languageName } from "@ekwe/shared";

export function getLanguageName(code: string | undefined | null): string {
  if (!code || code === "auto") return "auto-detected language";
  return languageName(code);
}
