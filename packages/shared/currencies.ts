export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
  flag: string;
  region: string;
  fallbackRate: number;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    decimals: 2,
    flag: "🇺🇸",
    region: "United States",
    fallbackRate: 1,
  },
  {
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    decimals: 2,
    flag: "🇳🇬",
    region: "Nigeria",
    fallbackRate: 1000,
  },
  {
    code: "GBP",
    symbol: "£",
    name: "British Pound",
    decimals: 2,
    flag: "🇬🇧",
    region: "United Kingdom",
    fallbackRate: 0.79,
  },
  {
    code: "EUR",
    symbol: "€",
    name: "Euro",
    decimals: 2,
    flag: "🇪🇺",
    region: "Europe",
    fallbackRate: 0.92,
  },
  {
    code: "GHS",
    symbol: "GH₵",
    name: "Ghanaian Cedi",
    decimals: 2,
    flag: "🇬🇭",
    region: "Ghana",
    fallbackRate: 14,
  },
  {
    code: "KES",
    symbol: "KSh",
    name: "Kenyan Shilling",
    decimals: 2,
    flag: "🇰🇪",
    region: "Kenya",
    fallbackRate: 140,
  },
  {
    code: "ZAR",
    symbol: "R",
    name: "South African Rand",
    decimals: 2,
    flag: "🇿🇦",
    region: "South Africa",
    fallbackRate: 18,
  },
  {
    code: "EGP",
    symbol: "E£",
    name: "Egyptian Pound",
    decimals: 2,
    flag: "🇪🇬",
    region: "Egypt",
    fallbackRate: 48,
  },
  {
    code: "XOF",
    symbol: "CFA",
    name: "West African CFA Franc",
    decimals: 0,
    flag: "🇸🇳",
    region: "West Africa (WAEMU)",
    fallbackRate: 600,
  },
  {
    code: "INR",
    symbol: "₹",
    name: "Indian Rupee",
    decimals: 2,
    flag: "🇮🇳",
    region: "India",
    fallbackRate: 80,
  },
];

export const DEFAULT_CURRENCY = "USD";

export const CURRENCY_BY_CODE: ReadonlyMap<string, CurrencyInfo> = new Map(
  CURRENCIES.map((c) => [c.code, c]),
);

export const SUPPORTED_CURRENCY_CODES: readonly string[] = CURRENCIES.map(
  (c) => c.code,
);

export function getCurrency(code: string): CurrencyInfo | undefined {
  return CURRENCY_BY_CODE.get(code.toUpperCase());
}

/**
 * Maps common country codes to their local currency, falling back to USD.
 */
export const COUNTRY_TO_CURRENCY_CODE: Record<string, string> = {
  NG: "NGN",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  GH: "GHS",
  KE: "KES",
  ZA: "ZAR",
  EG: "EGP",
  SN: "XOF",
  CI: "XOF",
  IN: "INR",
  US: "USD",
};
