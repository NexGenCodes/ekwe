import * as Localization from "expo-localization";

import { countryToCurrency } from "@ekwe/shared/money";

const DEFAULT_CURRENCY = "USD";

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