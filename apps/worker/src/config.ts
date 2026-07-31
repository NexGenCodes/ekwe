import { Tier } from "./types";
import { FREE_LIMITS, PREMIUM_LIMITS } from "@ekwe/shared";

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

const PLAN_CONFIG = {
  pipelines: {
    FREE: [
      "witai",
      "cohere",
      "gladia",
      "cloudflare",
      "groq",
    ] as readonly TranscribeProvider[],
    PREMIUM: [
      "deepgram",
      "gladia",
      "assemblyai",
      "witai",
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
  },
} as const;

// ─── Limits ────────────────────────────────────────────────────────

export function getLimits(tier: Tier): typeof FREE_LIMITS {
  return tier === "PREMIUM" ? PREMIUM_LIMITS : FREE_LIMITS;
}

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
