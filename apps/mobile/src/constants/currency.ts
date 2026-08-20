import * as Localization from "expo-localization";

import { countryToCurrency, resolvePaymentCurrency } from "@ekwe/shared/money";
import type { FlutterwaveCurrency } from "@ekwe/shared/money";

const DEFAULT_CURRENCY = "USD";

/**
 * Currencies the user can pick manually. A curated shortlist — full coverage
 * of the 14 billable codes is handled by auto-detection, so the manual
 * picker stays short. Anything here resolves cleanly via
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

/**
 * Auto-detects the user's currency (ISO 4217, e.g. "NGN"). Currency helpers
 * live in `@ekwe/shared/money`; this file only holds the device-specific
 * detection that depends on `expo-localization`.
 *
 * Prefers the device *region* (`regionCode`, the Region setting under
 * Language & Region) mapped through `countryToCurrency`: on Android
 * `currencyCode` follows the language tag (an English-US phone in Nigeria
 * reports USD), while `regionCode` reflects where the user actually is.
 * Falls back to `currencyCode` (authoritative on iOS) and finally USD.
 */
export function detectDeviceCurrency(): string {
  try {
    const locales = Localization.getLocales();
    const first = locales?.[0];

    const fromRegion = first?.regionCode
      ? countryToCurrency(first.regionCode)
      : undefined;
    if (fromRegion) {
      return fromRegion;
    }

    const code = first?.currencyCode?.toUpperCase();
    if (code && code.length === 3) {
      return code;
    }
  } catch {
    // Fail silently, fallback to USD
  }
  return DEFAULT_CURRENCY;
}

/**
 * The currency Ekwe actually bills in: a manual selection wins, otherwise the
 * device currency is resolved to a Flutterwave-billable code (unsupported
 * codes fall back to USD). This is the single currency used for BOTH the
 * pricing request and the checkout request, so the amount displayed always
 * matches the amount charged.
 */
export function getPaymentCurrency(manual?: string | null): FlutterwaveCurrency {
  return resolvePaymentCurrency(manual?.toUpperCase() ?? detectDeviceCurrency());
}