import * as Localization from "expo-localization";

import {
  COUNTRY_TO_CURRENCY_CODE,
  DEFAULT_CURRENCY,
} from "@ekwe/shared/currencies";

/**
 * Auto-detects the user's currency based on device localization settings.
 *
 * The definitive currency data + helpers (CURRENCIES, getCurrency, money
 * formatting) live in `@ekwe/shared/currencies`; this file only holds the
 * device-specific detection that depends on `expo-localization`.
 */
export function detectDeviceCurrency(): string {
  try {
    const locales = Localization.getLocales();
    if (locales && locales.length > 0) {
      const regionCode = locales[0].regionCode?.toUpperCase();
      if (regionCode && COUNTRY_TO_CURRENCY_CODE[regionCode]) {
        return COUNTRY_TO_CURRENCY_CODE[regionCode];
      }
    }
  } catch {
    // Fail silently, fallback to USD
  }
  return DEFAULT_CURRENCY;
}