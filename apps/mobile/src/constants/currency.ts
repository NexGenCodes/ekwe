/**
 * Manual currency selection for billing. The worker is the source of truth for
 * currency resolution (geo -> billable set -> USD fallback); the app only
 * records a manual override for the user-picked codes below, so no
 * device-side currency detection exists here anymore.
 */

/**
 * Currencies the user can pick manually. A curated shortlist — full coverage
 * of the 14 billable codes is handled by the worker's auto-resolution, so the
 * manual picker stays short. Anything here resolves cleanly via
 * `resolvePaymentCurrency`, and the resolved code is what pricing + checkout
 * actually use.
 */
export const MANUAL_CURRENCY_OPTIONS = [
  "NGN",
  "USD",
  "GHS",
  "KES",
  "ZAR",
  "GBP",
  "EUR",
  "XOF",
] as const;

/** Human-friendly display names for the manual options. */
export const CURRENCY_NAMES: Record<string, string> = {
  NGN: "Nigerian Naira",
  USD: "US Dollar",
  GHS: "Ghanaian Cedi",
  KES: "Kenyan Shilling",
  ZAR: "South African Rand",
  GBP: "British Pound",
  EUR: "Euro",
  XOF: "West African CFA Franc",
};
