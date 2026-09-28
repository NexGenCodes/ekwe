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
  | "openrouter";
type StreamProvider = "deepgram" | "witai" | "assemblyai" | "gladia";
type TranslateProvider =
  "groq" | "gemini" | "cohere" | "openrouter" | "cloudflare" | "mistral";
type SpeechProvider = "gemini" | "edge" | "deepgram" | "witai";

const PROVIDER_PIPELINES = {
  pipelines: {
    FREE: [
      "witai",
      "groq",
      "cloudflare",
      "gladia",
      "openrouter",
      "cohere",
    ] as readonly TranscribeProvider[],
    PREMIUM: [
      "witai",
      "assemblyai",
      "deepgram",
      "gladia",
      "groq",
      "openrouter",
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
    Speech: {
      FREE: ["edge", "witai"] as readonly SpeechProvider[],
      PREMIUM: [
        "gemini",
        "deepgram",
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
  witai: { premium: 10_000, free: 15_000 },
  groq: { premium: 8_000, free: 12_000 },
  openrouter: { premium: 10_000, free: 15_000 },
  cloudflare: { premium: 10_000, free: 15_000 },
} as const;

export const PROVIDER_SKIP_AUTO: Record<string, boolean> = {
  deepgram: false,
  cohere: true,
  gladia: false,
  assemblyai: false,
  witai: true,
  groq: false,
  openrouter: false,
  cloudflare: false,
};
