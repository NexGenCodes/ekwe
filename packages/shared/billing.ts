/**
 * ─── Billing Provider Registry ───────────────────────────────────
 *
 * Single source of truth for all payment provider constants, types, and
 * configuration schemas. Both the Cloudflare Worker and the mobile app
 * import from here to prevent drift.
 *
 * Provider model:
 *   - Flutterwave: web / direct payments (cards, mobile money, bank transfer)
 *
 * The purchase flow writes to the `user_subscriptions` table in Supabase,
 * and the custom access token hook reads from it to inject `is_pro` into
 * JWTs. This means the tier resolution is provider-agnostic.
 */

// ─── Provider Identifiers ────────────────────────────────────────

export const PAYMENT_PROVIDERS = {
  FLUTTERWAVE: "flutterwave",
} as const;

export type PaymentProvider =
  (typeof PAYMENT_PROVIDERS)[keyof typeof PAYMENT_PROVIDERS];

// ─── Subscription Plan Identifiers ───────────────────────────────
// Product IDs used as tx_ref metadata to correlate payments with plans.

export const SUBSCRIPTION_PLANS = {
  MONTHLY: {
    id: "ekwe_pro_monthly",
    name: "Ekwe Pro Monthly",
    duration: "monthly" as const,
  },
  ANNUAL: {
    id: "ekwe_pro_annual",
    name: "Ekwe Pro Annual",
    duration: "annual" as const,
  },
} as const;

export type SubscriptionPlanDuration =
  (typeof SUBSCRIPTION_PLANS)[keyof typeof SUBSCRIPTION_PLANS]["duration"];

// ─── Feature Flags ───────────────────────────────────────────────
// Server-controlled feature flags for payment providers. Stored in
// `payment_config` table and fetched by the mobile app on boot.

export interface PaymentFeatureFlags {
  /** Enable Flutterwave checkout (web / direct payments). */
  flutterwave_enabled: boolean;
  /**
   * Which payment provider the mobile app uses. Developer-only:
   * controlled through the `payment_config` table (Supabase), never overridden
   * by the user — there is no user-facing provider toggle.
   */
  default_provider: PaymentProvider;
}

export const DEFAULT_FEATURE_FLAGS: PaymentFeatureFlags = {
  flutterwave_enabled: true,
  default_provider: "flutterwave",
};

// ─── Webhook Event Types ─────────────────────────────────────────
// Normalized event shape that the Flutterwave webhook handler produces
// after parsing its payload.

export interface NormalizedBillingEvent {
  /** Provider that sent the event. */
  provider: PaymentProvider;
  /** Provider-specific event type (e.g. "charge.success"). */
  event_type: string;
  /**
   * Provider-specific unique identifier for idempotency.
   * Flutterwave: event.data.id (transaction ID)
   */
  idempotency_key: string;
  /** The user's Supabase UUID or email (for identity resolution). */
  user_id: string | null;
  email: string | null;
  /** Whether this event grants or revokes Pro access. */
  is_pro: boolean;
  /** Subscription expiry timestamp (null = lifetime / unknown). */
  expires_at: Date | null;
  /** Raw event payload for logging / debugging. */
  raw: unknown;
}

// ─── Webhook Verification ────────────────────────────────────────

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
}

// ─── Wire Error Codes (billing-specific) ─────────────────────────

export const BILLING_ERROR_CODES = {
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
  WEBHOOK_TIMESTAMP_EXPIRED: "WEBHOOK_TIMESTAMP_EXPIRED",
  WEBHOOK_MISSING_HEADERS: "WEBHOOK_MISSING_HEADERS",
  PAYMENT_PROVIDER_UNAVAILABLE: "PAYMENT_PROVIDER_UNAVAILABLE",
  PAYMENT_INITIALIZATION_FAILED: "PAYMENT_INITIALIZATION_FAILED",
  SUBSCRIPTION_NOT_FOUND: "SUBSCRIPTION_NOT_FOUND",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

// ─── Platform Helpers ────────────────────────────────────────────

/** Returns the providers available for the given platform. */
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

/**
 * Determines the effective provider given feature flags.
 * Provider choice is developer-only (set via `payment_config`); there
 * is no user preference override. Returns null when no provider is available.
 */
export function getEffectiveProvider(
  flags: PaymentFeatureFlags,
  platform: "ios" | "android" | "web",
): PaymentProvider | null {
  const available = getAvailableProviders(flags, platform);

  if (available.length === 0) return null;

  // Fall back to the default provider if available, otherwise first available
  if (available.includes(flags.default_provider)) {
    return flags.default_provider;
  }

  return available[0];
}
