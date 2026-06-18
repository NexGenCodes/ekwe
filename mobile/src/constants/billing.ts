export interface PlanFeature {
  title: string;
  included: boolean;
}

export interface PlanLimits {
  maxAudioBytes: number;
  maxTextChars: number;
  autoDetectAllowed: boolean;
  dictationDurationMs: number;
  historyRemoteTtlDays: number;
  streamingAllowed: boolean;
  transliterationAllowed: boolean;
  contextAwareness: boolean;
  customAvatarIcons: boolean;
  maxTargetLanguages: number;
  exportFormats: string[];
  ttsQuality: string;
  cooldownSeconds: number;
}

/**
 * Fallback defaults used until the live config is fetched from the worker.
 * The worker always enforces the real limits server-side.
 */
export const PLAN_LIMITS: { free: PlanLimits; pro: PlanLimits } = {
  free: {
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
    exportFormats: ['text'],
    ttsQuality: 'standard',
    cooldownSeconds: 3,
  },
  pro: {
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
    exportFormats: ['text', 'pdf', 'srt'],
    ttsQuality: 'premium',
    cooldownSeconds: 1,
  },
};

export interface FallbackPrice {
  amount: number;
  currency: string;
  symbol: string;
}

/**
 * USD-only fallback pricing used while the server response loads or when offline.
 * The server (via GET /plan) is the single source of truth for all currencies
 * using live FX conversion via Frankfurter API.
 */
export const DISPLAY_PRICING: Record<
  string,
  {
    monthly: FallbackPrice;
    annual: FallbackPrice;
    annualMonthlyCost: number;
    annualSavingPercent: number;
  }
> = {
  USD: {
    monthly: { amount: 3.00, currency: "USD", symbol: "$" },
    annual: { amount: 28.80, currency: "USD", symbol: "$" },
    annualMonthlyCost: 2.40,
    annualSavingPercent: 20,
  },
};

export const BILLING_PLANS = {
  free: {
    id: "free" as const,
    name: "Basic",
    tagline: "The full translation experience, with ads",
    price: 0,
    fallbackPrice: { amount: 0, currency: "USD", symbol: "$" },
    features: [
      { title: "Unlimited text translation", included: true },
      { title: "Voice dictation (up to 2 min)", included: true },
      { title: "30-day cloud history", included: true },
      { title: "Auto-detect spoken language", included: true },
      { title: "Ad-free experience", included: false },
      { title: "Extended voice dictation (up to 20 min)", included: false },
    ] as PlanFeature[],
  },
  pro: {
    id: "pro" as const,
    name: "Pro",
    tagline: "Zero distractions. Full power.",
    productIdMonthly: "ekwe_pro_monthly",
    productIdAnnual: "ekwe_pro_annual",
    features: [
      { title: "Ad-free experience", included: true },
      { title: "Extended voice dictation (up to 20 min)", included: true },
      { title: "1-year cloud history", included: true },
      { title: "Priority AI context processing", included: true },
    ] as PlanFeature[],
  },
} as const;
