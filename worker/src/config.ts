import { Tier } from "./types";

// ─── Raw Data ──────────────────────────────────────────────────────

interface PriceDetail {
  amount: number;
  currency: string;
  lowestUnit: number;
}

interface PlanPricing {
  monthly: PriceDetail;
  annual: PriceDetail;
}

const USD_PRICE = { monthly: { amount: 3.00, currency: 'USD', lowestUnit: 300 }, annual: { amount: 28.80, currency: 'USD', lowestUnit: 2880 } };

const PLAN_CONFIG = {
  plans: {
    FREE: {
      limits: {
        maxAudioBytes: 4_194_304,
        maxTextChars: 3_000,
        autoDetectAllowed: false,
        dictationDurationMs: 120_000,
        historyRemoteTtlDays: 30,
        streamingAllowed: false,
        transliterationAllowed: false,
        contextAwareness: false,
        customAvatarIcons: false,
        maxTargetLanguages: 1,
        exportFormats: ['text'] as readonly string[],
        ttsQuality: 'standard' as const,
        cooldownSeconds: 3,
      },
      features: {
        autoCopy: true,
      },
    },
    PREMIUM: {
      limits: {
        maxAudioBytes: 26_214_400,
        maxTextChars: 10_000,
        autoDetectAllowed: true,
        dictationDurationMs: 1_200_000,
        historyRemoteTtlDays: 365,
        streamingAllowed: true,
        transliterationAllowed: true,
        contextAwareness: true,
        customAvatarIcons: true,
        maxTargetLanguages: 3,
        exportFormats: ['text', 'pdf', 'srt'] as readonly string[],
        ttsQuality: 'premium' as const,
        cooldownSeconds: 1,
      },
      features: {
        autoCopy: true,
      },
    },
  },
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

type PlanTier = keyof typeof PLAN_CONFIG.plans;
type PlanLimits = (typeof PLAN_CONFIG.plans)[PlanTier]['limits'];
type PlanFeatures = (typeof PLAN_CONFIG.plans)[PlanTier]['features'] & Record<string, boolean>;

// ─── Limits ────────────────────────────────────────────────────────

export function getLimits(tier: Tier): PlanLimits {
  return PLAN_CONFIG.plans[tier]?.limits ?? PLAN_CONFIG.plans.FREE.limits;
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
