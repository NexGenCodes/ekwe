import * as Localization from "expo-localization";

export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  flag: string;
  region: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    flag: "🇺🇸",
    region: "United States",
  },
  {
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    flag: "🇳🇬",
    region: "Nigeria",
  },
  {
    code: "GBP",
    symbol: "£",
    name: "British Pound",
    flag: "🇬🇧",
    region: "United Kingdom",
  },
  { code: "EUR", symbol: "€", name: "Euro", flag: "🇪🇺", region: "Europe" },
  {
    code: "GHS",
    symbol: "GH₵",
    name: "Ghanaian Cedi",
    flag: "🇬🇭",
    region: "Ghana",
  },
  {
    code: "KES",
    symbol: "KSh",
    name: "Kenyan Shilling",
    flag: "🇰🇪",
    region: "Kenya",
  },
  {
    code: "ZAR",
    symbol: "R",
    name: "South African Rand",
    flag: "🇿🇦",
    region: "South Africa",
  },
  {
    code: "EGP",
    symbol: "E£",
    name: "Egyptian Pound",
    flag: "🇪🇬",
    region: "Egypt",
  },
  {
    code: "XOF",
    symbol: "CFA",
    name: "West African CFA Franc",
    flag: "🇸🇳",
    region: "West Africa (WAEMU)",
  },
  {
    code: "INR",
    symbol: "₹",
    name: "Indian Rupee",
    flag: "🇮🇳",
    region: "India",
  },
];

export const DEFAULT_CURRENCY = "USD";

/**
 * Maps common country codes to their local currency, falling back to USD.
 */
const COUNTRY_TO_CURRENCY_MAP: Record<string, string> = {
  NG: "NGN", // Nigeria
  GB: "GBP", // United Kingdom
  DE: "EUR", // Germany
  FR: "EUR", // France
  IT: "EUR", // Italy
  ES: "EUR", // Spain
  GH: "GHS", // Ghana
  KE: "KES", // Kenya
  ZA: "ZAR", // South Africa
  EG: "EGP", // Egypt
  SN: "XOF", // Senegal
  CI: "XOF", // Cote d'Ivoire
  IN: "INR", // India
  US: "USD", // USA
};

/**
 * Auto-detects the user's currency based on device localization settings.
 */
export function detectDeviceCurrency(): string {
  try {
    const locales = Localization.getLocales();
    if (locales && locales.length > 0) {
      const regionCode = locales[0].regionCode?.toUpperCase();
      if (regionCode && COUNTRY_TO_CURRENCY_MAP[regionCode]) {
        return COUNTRY_TO_CURRENCY_MAP[regionCode];
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
export function formatCurrency(amount: number, currencyCode: string): string {
  const config = SUPPORTED_CURRENCIES.find((c) => c.code === currencyCode) || {
    symbol: "$",
  };

  // Format based on standard representations
  return `${config.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
