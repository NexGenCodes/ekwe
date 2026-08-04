import * as Localization from "expo-localization";

import {
  CURRENCIES,
  COUNTRY_TO_CURRENCY_CODE,
  DEFAULT_CURRENCY,
} from "@ekwe/shared/currencies";
import { formatMoney } from "@ekwe/shared/money";

export type { CurrencyInfo } from "@ekwe/shared/currencies";
export type CurrencyConfig = (typeof CURRENCIES)[number];

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [...CURRENCIES];

export { DEFAULT_CURRENCY };

/**
 * Auto-detects the user's currency based on device localization settings.
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

/**
 * Formats a given amount into the specified currency locale format.
 */
export const formatCurrency = formatMoney;
