import type { FlutterwaveCurrency } from "./money";

export interface PlanLimits {
  maxAudioBytes: number;
  maxTextChars: number;
  autoDetectAllowed: boolean;
  dictationDurationMs: number;
  maxStreamDurationMs: number;
  historyRemoteTtlDays: number;
  streamingAllowed: boolean;
  transliterationAllowed: boolean;
  customAvatarIcons: boolean;
  maxLanguages: number;

  speechQuality: "standard" | "premium";
  cooldownSeconds: number;

  dailyTranslateLimit: number;

  dailyTranscribeLimit: number;

  dailySpeechCharsLimit: number;

  dailyStreamLimit: number;

  throttleTranslateThreshold: number;

  throttleTranscribeThreshold: number;
}

export interface PlanFeatures {
  autoCopy: boolean;
}

export interface PriceDetail {
  amount: number;
  currency: string;
  lowestUnit: number;
}

export interface PlanPricing {
  monthly: PriceDetail;
  annual: PriceDetail;
}

export interface PlanConfigPlans {
  FREE: {
    limits: PlanLimits;
    features: PlanFeatures;
  };
  PREMIUM: {
    limits: PlanLimits;
    features: PlanFeatures;
  };
}

export const FREE_LIMITS: PlanLimits = {
  maxAudioBytes: 5_242_880,
  maxTextChars: 1500,
  autoDetectAllowed: false,
  dictationDurationMs: 120_000,
  maxStreamDurationMs: 0,
  historyRemoteTtlDays: 30,
  streamingAllowed: false,
  transliterationAllowed: false,
  customAvatarIcons: false,
  maxLanguages: 5,

  speechQuality: "standard",
  cooldownSeconds: 3,
  dailyTranslateLimit: 25,
  dailyTranscribeLimit: 25,

  dailySpeechCharsLimit: 5000,
  dailyStreamLimit: 0,
  throttleTranslateThreshold: 0,
  throttleTranscribeThreshold: 0,
};

export const PREMIUM_LIMITS: PlanLimits = {
  maxAudioBytes: 26_214_400,
  maxTextChars: 2400,
  autoDetectAllowed: true,
  dictationDurationMs: 1_800_000,
  maxStreamDurationMs: 120_000,
  historyRemoteTtlDays: 365,
  streamingAllowed: true,
  transliterationAllowed: true,
  customAvatarIcons: true,

  maxLanguages: 5,
  speechQuality: "premium",
  cooldownSeconds: 1,
  dailyTranslateLimit: 0,
  dailyTranscribeLimit: 0,

  dailySpeechCharsLimit: 15000,
  dailyStreamLimit: 120,
  throttleTranslateThreshold: 500,
  throttleTranscribeThreshold: 200,
};

export const FREE_FEATURES: PlanFeatures = {
  autoCopy: true,
};

export const PREMIUM_FEATURES: PlanFeatures = {
  autoCopy: true,
};

export const PLAN_CONFIG: PlanConfigPlans = {
  FREE: {
    limits: FREE_LIMITS,
    features: FREE_FEATURES,
  },
  PREMIUM: {
    limits: PREMIUM_LIMITS,
    features: PREMIUM_FEATURES,
  },
};

export const USD_PRICE: PlanPricing = {
  monthly: { amount: 2.23, currency: "USD", lowestUnit: 223 },
  annual: { amount: 21.41, currency: "USD", lowestUnit: 2141 },
};

export interface LocalPrice {
  monthly: number;
  annual: number;
}

export const LOCAL_PRICES: Record<FlutterwaveCurrency, LocalPrice> = {
  USD: { monthly: 2.23, annual: 21.41 },
  NGN: { monthly: 3000, annual: 28800 },
  GHS: { monthly: 25, annual: 240 },
  KES: { monthly: 288, annual: 2765 },
  ZAR: { monthly: 36, annual: 346 },
  ZMW: { monthly: 41, annual: 394 },
  UGX: { monthly: 8200, annual: 78720 },
  TZS: { monthly: 5900, annual: 56640 },
  RWF: { monthly: 3260, annual: 31296 },
  XOF: { monthly: 1270, annual: 12192 },
  XAF: { monthly: 1270, annual: 12192 },
  GBP: { monthly: 1.65, annual: 15.84 },
  EUR: { monthly: 1.93, annual: 18.53 },
  CAD: { monthly: 3.09, annual: 29.66 },
};

export const MAX_AUDIO_BYTES = PREMIUM_LIMITS.maxAudioBytes;

export const SPEECH_MAX_TEXT_CHARS = 2400;

export const TRANSLATE_EXPANSION_CUSHION = 1.4;

export const PRO_PRODUCT_IDS = {
  monthly: "ekwe_pro_monthly",
  annual: "ekwe_pro_annual",
} as const;
