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
  ttsQuality: "standard" | "premium";
  cooldownSeconds: number;
  /** Daily hard cap for /translate, per user (0 = unlimited, never blocked). */
  dailyTranslateLimit: number;
  /** Daily hard cap for /transcribe, per user (0 = unlimited, never blocked). */
  dailyTranscribeLimit: number;
  /**
   * Daily character cap for /tts, per user — measured in generated characters,
   * not requests (0 = unavailable — FREE gets no worker TTS, on-device only).
   * Premium TTS is the most expensive provider call per user, so unlike the
   * translate/transcribe pools this one is a hard cap even for PREMIUM.
   */
  dailyTtsCharsLimit: number;
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
  dailyTtsCharsLimit: 0,
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
  // Moderate invisible speech ceiling — the client never surfaces it and
  // falls back to on-device speech when hit, so it only guards against
  // scripting (most of the pipeline rides Cloudflare's free tiers).
  dailyTtsCharsLimit: 5000,
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
 * subscription_config defaults (base $2.23/mo, 20% annual discount): the
 * worker /pricing endpoint is authoritative and this only shows while that
 * query has no data. Keep it in sync with the seed row.
 */
export const USD_PRICE: PlanPricing = {
  monthly: { amount: 2.23, currency: "USD", lowestUnit: 223 },
  annual: { amount: 21.41, currency: "USD", lowestUnit: 2141 },
};

/**
 * Default local price per Flutterwave-billable currency (the same "price tier"
 * model the app stores use). The annual price bakes in a ~20% discount over
 * 12 × monthly.
 *
 * NGN is the anchor: ₦3,000/mo (≈ $2 at the ~1,500 NGN/USD rate), and every
 * other currency is its equivalent so pricing feels consistent across markets.
 *
 * ⚠️ The authoritative copy lives in Supabase `subscription_config.local_prices`
 * (editable in one DB row with zero redeploys). THIS map is:
 *   1. the fallback the worker serves when Supabase is unreachable, and
 *   2. the mobile offline mirror while GET /pricing has no data.
 * Keep it in sync with the seed row and the migration that backfills it.
 *
 * The worker GET /pricing and POST /billing/checkout read the SAME source
 * (DB first, this map second), so the amount the Flutterwave flow collects is
 * always identical to what the billing screen shows. There is intentionally no
 * live FX — Flutterwave does not auto-convert, so we bill exactly these
 * amounts in exactly these currencies.
 *
 * Keep the keys aligned with `FLUTTERWAVE_CURRENCIES` in `./money.ts`.
 */
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
