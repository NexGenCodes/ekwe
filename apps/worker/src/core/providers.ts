import type { Tier } from "@/core/limits";

import {
  LANGUAGE_CAPABILITIES,
  isLanguageSupported,
} from "@ekwe/shared/languageCapabilities";

type TranscribeProvider =
  | "witai"
  | "cohere"
  | "gladia"
  | "cloudflare"
  | "groq"
  | "deepgram"
  | "assemblyai"
  | "elevenlabs";
type StreamProvider = "deepgram" | "witai" | "assemblyai" | "gladia";
type TranslateProvider =
  "groq" | "gemini" | "cohere" | "openrouter" | "cloudflare" | "mistral";
type SpeechProvider = "gemini" | "edge" | "deepgram" | "witai" | "elevenlabs";

const PROVIDER_PIPELINES = {
  pipelines: {
    // OpenRouter is translate-only: its audio endpoint answers 402 on a free
    // account and it publishes no `:free` STT model, so it implements no
    // transcription capability and stays out of every pool here.
    FREE: [
      "witai",
      "groq",
      "cloudflare",
      "gladia",
      "cohere",
    ] as readonly TranscribeProvider[],
    PREMIUM: [
      "witai",
      "assemblyai",
      "deepgram",
      "elevenlabs",
      "gladia",
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
      // Groq leads the free pool on throughput rather than quality: its key pool
      // absorbs the volume, and Gemini is held back at second-to-last so the
      // languages it is actually best at are not spent on requests Groq could
      // have answered. OpenRouter is the deliberate last resort — free but the
      // weakest, so a user only reaches it after everything else failed.
      FREE: [
        "groq",
        "cloudflare",
        "cohere",
        "gemini",
        "openrouter",
      ] as readonly TranslateProvider[],
      // Gemini first: it is the strongest translator we have for the Nigerian
      // languages and the European ones alike, so a premium request should meet
      // its best answer before any fallback. Mistral follows as a fast (~650ms)
      // second opinion. OpenRouter is absent here on purpose — it is a
      // free-tier model, so letting a paying user fall through to it would be a
      // worse answer than the last resort the free pool already gets.
      PREMIUM: [
        "gemini",
        "cohere",
        "mistral",
        "groq",
        "cloudflare",
      ] as readonly TranslateProvider[],
    },
    Speech: {
      FREE: ["edge", "witai"] as readonly SpeechProvider[],
      PREMIUM: [
        "gemini",
        "deepgram",
        "elevenlabs",
        "edge",
        "witai",
      ] as readonly SpeechProvider[],
    },
  },
} as const;

export function getTranscribeProviderNames(tier: Tier): readonly string[] {
  return (
    PROVIDER_PIPELINES.pipelines[tier] ?? PROVIDER_PIPELINES.pipelines.FREE
  );
}

export function getStreamingProviderNames(): readonly string[] {
  return PROVIDER_PIPELINES.pipelines.STREAMING;
}

export function getTranslateProviderNames(tier: Tier): readonly string[] {
  return (
    PROVIDER_PIPELINES.pipelines.TRANSLATE[tier] ??
    PROVIDER_PIPELINES.pipelines.TRANSLATE.FREE
  );
}

/**
 * Providers that can synthesize, in pool order.
 *
 * Only used where the raw pipeline is what is wanted — the synthesis guard in
 * `routes/synthesize.ts`. Anything deciding which providers to *offer* must go
 * through `getProviderNamesFor("tts", tier)` in `providers/index.ts`, which is
 * the pipeline intersected with the capabilities the modules actually
 * implement. The two agreeing today is a coincidence of the current registry,
 * not a guarantee.
 */
export function getSpeechProviderNames(tier: Tier): readonly string[] {
  return (
    PROVIDER_PIPELINES.pipelines.Speech[tier] ??
    PROVIDER_PIPELINES.pipelines.Speech.FREE
  );
}

/**
 * Synthesis coverage is declared once, in the shared language registry, so the
 * picker and the router cannot disagree about which languages a voice exists
 * for. Edge and Gemini are marked unbounded there rather than listed as "all",
 * and Wit is bounded to its real 132-language set instead of being treated as
 * language-agnostic.
 */
export function speechProviderSupports(
  provider: string,
  lang: string,
): boolean {
  if (!(provider in LANGUAGE_CAPABILITIES)) return false;
  return isLanguageSupported(provider as SpeechProvider, "tts", lang);
}

export const PROVIDER_TIMEOUT = {
  deepgram: { premium: 5_000, free: 8_000 },
  cohere: { premium: 8_000, free: 12_000 },
  gladia: { premium: 8_000, free: 12_000 },
  assemblyai: { premium: 8_000, free: 15_000 },
  elevenlabs: { premium: 10_000, free: 15_000 },
  witai: { premium: 10_000, free: 15_000 },
  groq: { premium: 8_000, free: 12_000 },
  cloudflare: { premium: 10_000, free: 15_000 },
  // Text-to-text only. Mistral is the fast second opinion, so it gets a tight
  // budget; OpenRouter is the last resort and slow, so it gets the whole one.
  gemini: { premium: 8_000, free: 12_000 },
  mistral: { premium: 6_000, free: 10_000 },
  openrouter: { premium: 12_000, free: 15_000 },
} as const;
