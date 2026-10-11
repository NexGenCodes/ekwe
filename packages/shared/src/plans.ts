import type { FlutterwaveCurrency } from "./money";
import { WITAI_SAFE_DURATION_MS } from "./providerLimits";

export interface PlanLimits {
  maxAudioBytes: number;
  maxTextChars: number;
  autoDetectAllowed: boolean;
  dictationDurationMs: number;
  maxStreamDurationMs: number;
  maxConcurrentStreams: number;
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
  maxConcurrentStreams: 0,
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
  maxAudioBytes: 10_485_760,
  maxTextChars: 2400,
  autoDetectAllowed: true,
  dictationDurationMs: 1_800_000,
  maxStreamDurationMs: 120_000,
  maxConcurrentStreams: 8,
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
  throttleTranscribeThreshold: 500,
};

export const FREE_FEATURES: PlanFeatures = {
  autoCopy: false,
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

// Generous safety cap for *input* audio files (pre-transcode). The tier cap
// (MAX_AUDIO_BYTES) applies to the transcoded Ogg Opus output; inputs can be
// much larger and still transcode to a few MB. Guards against decompression
// bombs — 100 MB covers any realistic voice note at uncompressed rates.
export const MAX_AUDIO_INPUT_BYTES = 100 * 1024 * 1024;

/**
 * Re-exported from the provider registry so both sides of the wire agree on
 * what Wit's ceiling is. The registry is the source of truth; this keeps the
 * existing `plans` import path working.
 */
export {
  WITAI_MAX_DURATION_MS,
  WITAI_SAFE_DURATION_MS,
  WITAI_MIN_SPEECH_BYTES,
  CF_WORKERS_AI_MAX_AUDIO_BYTES,
  PROVIDER_LIMITS,
  providerAcceptsCodec,
  sttLimits,
  tttLimits,
  ttsLimits,
} from "./providerLimits";
export type {
  AudioCodec,
  ProviderLimitsEntry,
  SttLimits,
  TttLimits,
  TtsLimits,
} from "./providerLimits";

/**
 * Whether to hand this clip to Wit.ai in its own codec rather than letting it
 * go out as Opus.
 *
 * Wit is first in both transcription pipelines because it is the fastest thing
 * we have, but `/dictation` parses Vorbis-in-Ogg and answers Opus-in-Ogg with
 * silence rather than an error. Two conditions, both necessary:
 *
 *  - a language is named. Wit holds one key per language, so for `auto` there is
 *    no key to pick and the provider is skipped server-side regardless.
 *  - the clip is inside Wit's duration ceiling.
 */
export function shouldUploadVorbis(
  durationMs: number,
  lang: string | null | undefined,
): boolean {
  if (!lang || lang === "auto") return false;
  return durationMs > 0 && durationMs <= WITAI_SAFE_DURATION_MS;
}

export const SPEECH_MAX_TEXT_CHARS = 2400;

export const TRANSLATE_EXPANSION_CUSHION = 1.4;

export const PRO_PRODUCT_IDS = {
  monthly: "ekwe_pro_monthly",
  annual: "ekwe_pro_annual",
} as const;
