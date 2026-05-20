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

export const PLAN_LIMITS = {
  free: {
    maxPinnedLanguages: 5,
    maxSelectedLanguages: 5,
    dictationDurationMs: 30_000, // 30 seconds
    historyLocalTtlDays: 7, // Kept on device for 7 days
    historyRemoteTtlDays: 14, // Kept in Supabase DB for 14 days
    textTranslationMaxChars: 3000,
    autoLanguageDetect: false, // Auto detect is Pro only
    customAvatarIcons: false,
    autoCopy: false,
    contextAwareness: false,
  },
  pro: {
    maxPinnedLanguages: 5,
    maxSelectedLanguages: 5,
    dictationDurationMs: 60_000, // 60 seconds
    historyLocalTtlDays: 7, // Still 7 to save device storage
    historyRemoteTtlDays: 30, // Kept in Supabase DB for 30 days
    textTranslationMaxChars: 10000,
    autoLanguageDetect: true,
    customAvatarIcons: true,
    autoCopy: true,
    contextAwareness: true,
  },
} as const;

// ─── UI Plan Definitions ─────────────────────────────────────────────────────

export const BILLING_PLANS = {
  free: {
    id: 'free' as const,
    name: 'Free',
    tagline: 'The full translation experience, with ads',
    price: 0,
    // Shown as fallback only — real price comes from RevenueCat priceString
    fallbackPrice: { amount: 0, currency: 'USD', symbol: '$' },
    features: [
      { title: 'Unlimited text translation', included: true },
      { title: 'Voice dictation (up to 30s)', included: true },
      { title: 'Transliteration / romanization', included: true },
      { title: 'Up to 3 active languages', included: true },
      { title: 'History (7 days on device, 14 days cloud)', included: true },
      { title: 'Light & dark mode', included: true },
      { title: 'Ad-free experience', included: false },
      { title: 'Voice dictation up to 60s', included: false },
      { title: 'Up to 5 active languages', included: false },
      { title: 'Custom avatar icons', included: false },
      { title: 'Auto-copy on translate', included: false },
      { title: 'App-context awareness (bubble)', included: false },
      { title: '30-day cloud history', included: false },
    ] as PlanFeature[],
  },
  pro: {
    id: 'pro' as const,
    name: 'Pro',
    tagline: 'Zero distractions. Full power.',
    // ── DISPLAY FALLBACK PRICES (shown before RevenueCat loads) ──────────────
    // Real prices are returned by RevenueCat's StoreProduct.priceString
    // These are set per-country in App Store Connect / Google Play Console:
    //   USA:     $1.99/mo,  $14.99/yr
    //   UK:      £1.99/mo,  £14.99/yr
    //   Nigeria: ₦3,000/mo, ₦24,000/yr  (approximate — set in ASC/Play Console)
    fallbackPriceMonthly: { amount: 1.99, currency: 'USD', symbol: '$' },
    fallbackPriceAnnual: { amount: 14.99, currency: 'USD', symbol: '$' },
    annualMonthlyCost: 1.25, // Fallback display only
    annualSavingPercent: 37,
    // RevenueCat product identifiers — must match App Store Connect / Play Console
    productIdMonthly: 'ekwe_pro_monthly',
    productIdAnnual: 'ekwe_pro_annual',
    features: [
      { title: 'Unlimited text translation', included: true },
      { title: 'Voice dictation up to 60s', included: true },
      { title: 'Transliteration / romanization', included: true },
      { title: 'Up to 5 active languages', included: true },
      { title: '30-day cloud history (access anytime)', included: true },
      { title: 'Light & dark mode', included: true },
      { title: 'Ad-free experience', included: true },
      { title: 'Custom avatar icons', included: true },
      { title: 'Auto-copy on translate', included: true },
      { title: 'App-context awareness (bubble)', included: true },
      { title: 'Priority AI processing', included: true },
      { title: 'Early access to new features', included: true },
    ] as PlanFeature[],
  },
} as const;
