export interface PlanLimits {
  maxAudioBytes: number;
  maxTextChars: number;
  autoDetectAllowed: boolean;
  dictationDurationMs: number;
  maxStreamDurationMs: number;
  historyRemoteTtlDays: number;
  streamingAllowed: boolean;
  transliterationAllowed: boolean;
  contextAwareness: boolean;
  customAvatarIcons: boolean;
  maxLanguages: number;
  exportFormats: readonly string[];
  ttsQuality: "standard" | "premium";
  cooldownSeconds: number;
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
  contextAwareness: false,
  customAvatarIcons: false,
  maxLanguages: 5,
  exportFormats: ["text"],
  ttsQuality: "standard",
  cooldownSeconds: 3,
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
  contextAwareness: true,
  customAvatarIcons: true,
  maxLanguages: 5,
  exportFormats: ["text", "pdf", "srt"],
  ttsQuality: "premium",
  cooldownSeconds: 1,
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
  monthly: { amount: 3.0, currency: "USD", lowestUnit: 300 },
  annual: { amount: 28.8, currency: "USD", lowestUnit: 2880 },
};
