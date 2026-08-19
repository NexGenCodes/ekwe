export { type Tier } from "./limits";
import type { Tier } from "./limits";

type TranscribeProvider =
  | "witai"
  | "cohere"
  | "gladia"
  | "cloudflare"
  | "groq"
  | "deepgram"
  | "assemblyai";
type StreamProvider = "deepgram" | "witai" | "assemblyai" | "gladia";
type TranslateProvider =
  "groq" | "gemini" | "cohere" | "openrouter" | "cloudflare" | "mistral";
type TtsProvider = "gemini" | "aura2" | "aura1" | "melotts";

const PLAN_CONFIG = {
  pipelines: {
    FREE: [
      "witai",
      "cohere",
      "gladia",
      "groq",
      "cloudflare",
    ] as readonly TranscribeProvider[],
    PREMIUM: [
      "deepgram",
      "witai",
      "gladia",
      "assemblyai",
      "groq",
      "cloudflare",
    ] as readonly TranscribeProvider[],
    STREAMING: [
      "deepgram",
      "witai",
      "assemblyai",
      "gladia",
    ] as readonly StreamProvider[],
    TRANSLATE: {
      FREE: [
        "groq",
        "gemini",
        "cohere",
        "openrouter",
        "cloudflare",
      ] as readonly TranslateProvider[],
      PREMIUM: [
        "gemini",
        "cohere",
        "mistral",
        "groq",
        "openrouter",
        "cloudflare",
      ] as readonly TranslateProvider[],
    },
    TTS: {
      PREMIUM: [
        "gemini",
        "aura2",
        "aura1",
        "melotts",
      ] as readonly TtsProvider[],
    },
  },
} as const;

// ─── Pipelines: Transcribe ─────────────────────────────────────────

export function getTranscribeProviderNames(tier: Tier): readonly string[] {
  return PLAN_CONFIG.pipelines[tier] ?? PLAN_CONFIG.pipelines.FREE;
}

// ─── Pipelines: Streaming ──────────────────────────────────────────

export function getStreamingProviderNames(): readonly string[] {
  return PLAN_CONFIG.pipelines.STREAMING;
}

// ─── Pipelines: Translate ──────────────────────────────────────────

export function getTranslateProviderNames(tier: Tier): readonly string[] {
  return (
    PLAN_CONFIG.pipelines.TRANSLATE[tier] ??
    PLAN_CONFIG.pipelines.TRANSLATE.FREE
  );
}

// ─── Pipelines: Text-to-Speech ─────────────────────────────────────
// Premium-only: `/tts` is a 403 for FREE tier, so no FREE pipeline exists.

export function getTtsProviderNames(): readonly string[] {
  return PLAN_CONFIG.pipelines.TTS.PREMIUM;
}

/**
 * Languages each TTS provider can actually speak. Providers gate themselves
 * here rather than in the model call — a spoken language is a hard capability
 * (unlike translation, where any model can attempt any language).
 */
const TTS_LANGUAGE_SUPPORT: Readonly<
  Record<TtsProvider, readonly string[] | "all">
> = {
  gemini: "all",
  aura2: ["en", "es"],
  aura1: ["en"],
  melotts: ["en", "fr", "es", "zh", "ja", "ko"],
};

export function ttsProviderSupports(provider: string, lang: string): boolean {
  const supported = TTS_LANGUAGE_SUPPORT[provider as TtsProvider];
  if (!supported) return false;
  return supported === "all" || supported.includes(lang);
}
