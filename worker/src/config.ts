import { Tier } from "./types";
import { PLAN_CONFIG as SHARED_PLAN_CONFIG, USD_PRICE } from "../../shared/plans";
import type { PlanPricing } from "../../shared/plans";

const PLAN_CONFIG = {
  plans: SHARED_PLAN_CONFIG,
  pipelines: {
    FREE: ['witai', 'cohere', 'gladia', 'cloudflare', 'groq'] as readonly string[],
    PREMIUM: ['deepgram', 'gladia', 'assemblyai', 'witai', 'groq', 'cloudflare'] as readonly string[],
    STREAMING: ['deepgram', 'witai', 'assemblyai', 'gladia'] as readonly string[],
    TRANSLATE: {
      FREE: ['groq', 'gemini', 'cohere', 'openrouter', 'cloudflare'] as readonly string[],
      PREMIUM: ['gemini', 'cohere', 'mistral', 'groq', 'openrouter', 'cloudflare'] as readonly string[],
    },
  },
  pricing: {
    USD: USD_PRICE,
  },
} as const;

export { PLAN_CONFIG };

// ─── Limits ────────────────────────────────────────────────────────

import { FREE_LIMITS, PREMIUM_LIMITS } from "../../shared/plans";

export function getLimits(tier: Tier): typeof FREE_LIMITS {
  return tier === "PREMIUM" ? PREMIUM_LIMITS : FREE_LIMITS;
}

// ─── Base Pricing (USD) ────────────────────────────────────────────

export const PRICING_TABLE: Record<string, PlanPricing> = {
  USD: USD_PRICE,
};

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
  return PLAN_CONFIG.pipelines.TRANSLATE[tier] ?? PLAN_CONFIG.pipelines.TRANSLATE.FREE;
}
