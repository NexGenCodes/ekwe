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
  ttsQuality: "standard" | "premium";
  cooldownSeconds: number;
  /** Daily hard cap for /translate, per user (0 = unlimited, never blocked). */
  dailyTranslateLimit: number;
  /** Daily hard cap for /transcribe, per user (0 = unlimited, never blocked). */
  dailyTranscribeLimit: number;
  /**
   * Abuse throttle for /translate. Once a day's count crosses this threshold
   * the user is served FREE-tier limits (slower cooldown, no premium features)
   * until UTC midnight — throttled, never blocked. 0 = no throttle.
   */
  throttleTranslateThreshold: number;
  /** Abuse throttle for /transcribe. See throttleTranslateThreshold. */
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
  maxTextChars: 3_000,
  autoDetectAllowed: false,
  dictationDurationMs: 120_000,
  maxStreamDurationMs: 0,
  historyRemoteTtlDays: 30,
  streamingAllowed: false,
  transliterationAllowed: false,
  customAvatarIcons: false,
  maxLanguages: 5,
  ttsQuality: "standard",
  cooldownSeconds: 3,
  dailyTranslateLimit: 25,
  dailyTranscribeLimit: 25,
  throttleTranslateThreshold: 0,
  throttleTranscribeThreshold: 0,
};

export const PREMIUM_LIMITS: PlanLimits = {
  maxAudioBytes: 26_214_400,
  maxTextChars: 10_000,
  autoDetectAllowed: true,
  dictationDurationMs: 1_800_000,
  maxStreamDurationMs: 120_000,
  historyRemoteTtlDays: 365,
  streamingAllowed: true,
  transliterationAllowed: true,
  customAvatarIcons: true,
  maxLanguages: 5,
  ttsQuality: "premium",
  cooldownSeconds: 1,
  dailyTranslateLimit: 0,
  dailyTranscribeLimit: 0,
  throttleTranslateThreshold: 500,
  throttleTranscribeThreshold: 500,
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

/**
 * Offline fallback price for the mobile billing screen. Mirrors the
 * subscription_config defaults (base $2.00/mo, 20% annual discount): the
 * worker /pricing endpoint is authoritative and this only shows while that
 * query has no data. Keep it in sync with the seed row.
 */
export const USD_PRICE: PlanPricing = {
  monthly: { amount: 2.0, currency: "USD", lowestUnit: 200 },
  annual: { amount: 19.2, currency: "USD", lowestUnit: 1920 },
};

export const MAX_AUDIO_BYTES = PREMIUM_LIMITS.maxAudioBytes;

/**
 * Hard character cap for the /tts pipeline (identical for every tier). The
 * mobile app mirrors it to short-circuit requests it knows the worker will
 * reject; keeping it here prevents the two caps from drifting.
 */
export const TTS_MAX_TEXT_CHARS = 1000;

// Product identifiers shared across the mobile app and the Flutterwave webhook.
// Keeping them here prevents drift between the webhook (product ids) and the
// mobile billing UI.
export const PRO_PRODUCT_IDS = {
  monthly: "ekwe_pro_monthly",
  annual: "ekwe_pro_annual",
} as const;
