/**
 * Ekwe Billing Plan Configuration
 *
 * ─── SAFETY NOTE ───────────────────────────────────────────────────────────
 * Pricing values here are for *display/fallback only* (shown before RevenueCat
 * loads, or in edge cases). The actual price displayed on the billing screen
 * MUST come from RevenueCat's `StoreProduct.priceString`, which is already
 * localized by Apple/Google for the user's storefront region. This means:
 *   - Nigerian users will automatically see ₦ NGN prices
 *   - UK users will see £ GBP prices
 *   - US users will see $ USD prices
 * You never need to manually detect or convert currency.
 *
 * ─── ENFORCEMENT ───────────────────────────────────────────────────────────
 * Limits below (language count, dictation duration, history TTL) are the
 * SINGLE source of truth. They must be used in:
 *   - settings.tsx  → language grid max selection
 *   - useVoiceDictation hook → maxDurationMs
 *   - HistoryService → local TTL & remote TTL query window
 *   - ProfileIdentity → avatar icons gate
 */

export interface PlanFeature {
  title: string;
  included: boolean;
}

// ─── Feature Limits ──────────────────────────────────────────────────────────
// Security note: local retention is flat-rate for all users to avoid trusting
// client-side isPro (which could be tampered with via MMKV on rooted devices).
// Plan differentiation is cloud-side only, enforced server-side by the
// cleanup_expired_history Supabase function.

export const PLAN_LIMITS = {
  free: {
    maxPinnedLanguages: 5,
    maxSelectedLanguages: 5,
    dictationDurationMs: 120_000, // 2 minutes
    historyLocalTtlDays: 7, // Flat for all users (tamper-safe)
    historyRemoteTtlDays: 30, // Cloud retention — enforced server-side
    textTranslationMaxChars: 3000,
    autoLanguageDetect: true, // Now free for all!
    customAvatarIcons: false,
    autoCopy: false,
    contextAwareness: false,
  },
  pro: {
    maxPinnedLanguages: 5,
    maxSelectedLanguages: 5,
    dictationDurationMs: 1_200_000, // 20 minutes
    historyLocalTtlDays: 7, // Flat for all users (tamper-safe)
    historyRemoteTtlDays: 365, // Cloud retention — 1 year for Pro
    textTranslationMaxChars: 10000,
    autoLanguageDetect: true,
    customAvatarIcons: true,
    autoCopy: true,
    contextAwareness: true,
  },
} as const;

export interface FallbackPrice {
  amount: number;
  currency: string;
  symbol: string;
}

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
    monthly: { amount: 3.5, currency: "USD", symbol: "$" },
    annual: { amount: 35.0, currency: "USD", symbol: "$" },
    annualMonthlyCost: 2.91,
    annualSavingPercent: 17,
  },
  NGN: {
    monthly: { amount: 3500, currency: "NGN", symbol: "₦" },
    annual: { amount: 35000, currency: "NGN", symbol: "₦" },
    annualMonthlyCost: 2916.67,
    annualSavingPercent: 17,
  },
  GBP: {
    monthly: { amount: 2.5, currency: "GBP", symbol: "£" },
    annual: { amount: 24.0, currency: "GBP", symbol: "£" },
    annualMonthlyCost: 2.0,
    annualSavingPercent: 20,
  },
  EUR: {
    monthly: { amount: 2.5, currency: "EUR", symbol: "€" },
    annual: { amount: 24.0, currency: "EUR", symbol: "€" },
    annualMonthlyCost: 2.0,
    annualSavingPercent: 20,
  },
  GHS: {
    monthly: { amount: 35.0, currency: "GHS", symbol: "GH₵" },
    annual: { amount: 340.0, currency: "GHS", symbol: "GH₵" },
    annualMonthlyCost: 28.33,
    annualSavingPercent: 19,
  },
  KES: {
    monthly: { amount: 350.0, currency: "KES", symbol: "KSh" },
    annual: { amount: 3400.0, currency: "KES", symbol: "KSh" },
    annualMonthlyCost: 283.33,
    annualSavingPercent: 19,
  },
  ZAR: {
    monthly: { amount: 45.0, currency: "ZAR", symbol: "R" },
    annual: { amount: 440.0, currency: "ZAR", symbol: "R" },
    annualMonthlyCost: 36.67,
    annualSavingPercent: 18,
  },
  EGP: {
    monthly: { amount: 120.0, currency: "EGP", symbol: "E£" },
    annual: { amount: 1200.0, currency: "EGP", symbol: "E£" },
    annualMonthlyCost: 100.0,
    annualSavingPercent: 16,
  },
  XOF: {
    monthly: { amount: 1500.0, currency: "XOF", symbol: "CFA" },
    annual: { amount: 14000.0, currency: "XOF", symbol: "CFA" },
    annualMonthlyCost: 1166.67,
    annualSavingPercent: 22,
  },
  INR: {
    monthly: { amount: 200.0, currency: "INR", symbol: "₹" },
    annual: { amount: 2000.0, currency: "INR", symbol: "₹" },
    annualMonthlyCost: 166.67,
    annualSavingPercent: 17,
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
