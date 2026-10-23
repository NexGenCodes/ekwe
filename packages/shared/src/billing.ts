import { WORKER_ERROR_CODES } from "./errors";
import type { WorkerErrorCode } from "./errors";

export const PAYMENT_PROVIDERS = {
  FLUTTERWAVE: "flutterwave",
} as const;

export type PaymentProvider =
  (typeof PAYMENT_PROVIDERS)[keyof typeof PAYMENT_PROVIDERS];

export const SUBSCRIPTION_PLANS = {
  MONTHLY: {
    id: "ekwe_pro_monthly",
    name: "Ekwe Paid Monthly",
    duration: "monthly" as const,
  },
  ANNUAL: {
    id: "ekwe_pro_annual",
    name: "Ekwe Paid Annual",
    duration: "annual" as const,
  },
} as const;

export type SubscriptionPlanDuration =
  (typeof SUBSCRIPTION_PLANS)[keyof typeof SUBSCRIPTION_PLANS]["duration"];

export interface PaymentFeatureFlags {
  flutterwave_enabled: boolean;

  default_provider: PaymentProvider;
}

export const DEFAULT_FEATURE_FLAGS: PaymentFeatureFlags = {
  flutterwave_enabled: true,
  default_provider: "flutterwave",
};

export interface NormalizedBillingEvent {
  provider: PaymentProvider;

  event_type: string;

  idempotency_key: string;

  user_id: string | null;
  email: string | null;

  is_pro: boolean;

  expires_at: Date | null;

  raw: unknown;
}

export type WebhookProvider = "flutterwave" | "unknown";

export interface WebhookVerificationResult {
  isValid: boolean;
  provider: WebhookProvider;
  error?: string;
  code?: WorkerErrorCode;
}

export const BILLING_ERROR_CODES = {
  WEBHOOK_SIGNATURE_INVALID: WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
  WEBHOOK_TIMESTAMP_EXPIRED: WORKER_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED,
  WEBHOOK_MISSING_HEADERS: WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS,
  PAYMENT_PROVIDER_UNAVAILABLE: WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE,
  PAYMENT_INITIALIZATION_FAILED:
    WORKER_ERROR_CODES.PAYMENT_INITIALIZATION_FAILED,
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

export function getAvailableProviders(
  flags: PaymentFeatureFlags,
  _platform: "ios" | "android" | "web",
): PaymentProvider[] {
  const providers: PaymentProvider[] = [];

  if (flags.flutterwave_enabled) {
    providers.push("flutterwave");
  }

  return providers;
}

export function getEffectiveProvider(
  flags: PaymentFeatureFlags,
  platform: "ios" | "android" | "web",
): PaymentProvider | null {
  const available = getAvailableProviders(flags, platform);

  if (available.length === 0) return null;

  if (available.includes(flags.default_provider)) {
    return flags.default_provider;
  }

  return available[0];
}
