import { countries } from "countries-list";

const decimalsCache = new Map<string, number>();

export function getDecimals(code: string): number {
  const upperCode = code.toUpperCase();
  if (decimalsCache.has(upperCode)) {
    return decimalsCache.get(upperCode)!;
  }
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: upperCode,
    }).formatToParts(1.23);
    const fraction = parts.find((p) => p.type === "fraction");
    const result = fraction ? fraction.value.length : 0;
    decimalsCache.set(upperCode, result);
    return result;
  } catch {
    return 2;
  }
}

export const CURRENCY_SYMBOLS: Record<FlutterwaveCurrency, string> = {
  USD: "$",
  NGN: "₦",
  GHS: "₵",
  KES: "sh",
  ZAR: "R",
  ZMW: "ZK",
  UGX: "USh",
  TZS: "TSh",
  RWF: "RF",
  XOF: "FCFA",
  XAF: "FCFA",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
};

const symbolCache = new Map<string, string>();

export function getCurrencySymbol(code: string): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  const explicit = CURRENCY_SYMBOLS[upper as FlutterwaveCurrency];
  if (explicit) {
    return explicit;
  }
  if (symbolCache.has(upper)) {
    return symbolCache.get(upper)!;
  }
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: upper,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const result = parts.find((p) => p.type === "currency")?.value || "$";
    symbolCache.set(upper, result);
    return result;
  } catch {
    return "$";
  }
}

export function roundToCurrency(amount: number, code: string): number {
  const d = getDecimals(code);
  return Math.round(amount * 10 ** d) / 10 ** d;
}

export function toLowestUnit(amount: number, code: string): number {
  return Math.round(amount * 10 ** getDecimals(code));
}

export function computeSavingPercent(
  monthlyAmount: number,
  annualAmount: number,
): number {
  return Math.round((1 - annualAmount / (monthlyAmount * 12)) * 100);
}

export function formatAmount(amount: number, code: string): string {
  const upperCode = code.toUpperCase();
  const decimals = getDecimals(upperCode);

  const dropDecimals = ["NGN", "CAD", "USD", "GHS"].includes(upperCode);
  const minimumFractionDigits = dropDecimals && amount % 1 === 0 ? 0 : decimals;

  return amount.toLocaleString("en-US", {
    minimumFractionDigits,
    maximumFractionDigits: decimals,
  });
}

export function formatMoney(amount: number, code: string): string {
  const symbol = getCurrencySymbol(code);
  return `${symbol}${formatAmount(amount, code)}`;
}

export function countryToCurrency(countryCode: string): string | undefined {
  const country =
    countries[countryCode.toUpperCase() as keyof typeof countries];
  return country?.currency?.[0];
}

const currencyCountriesCache = new Map<string, string[]>();

export function countryNamesForCurrency(code: string): string[] {
  const upper = code.toUpperCase();
  const cached = currencyCountriesCache.get(upper);
  if (cached) {
    return cached;
  }
  const result = Object.values(countries)
    .filter((c) =>
      (c.currency as readonly string[] | undefined)?.includes(upper),
    )
    .map((c) => c.name)
    .sort();
  currencyCountriesCache.set(upper, result);
  return result;
}

export function countrySummaryForCurrency(
  code: string,
  max: number = 2,
): string {
  const names = countryNamesForCurrency(code);
  if (names.length <= max) {
    return names.join(", ");
  }
  return `${names.slice(0, max).join(", ")} & ${names.length - max} more`;
}

export const FLUTTERWAVE_CURRENCIES = [
  "USD",
  "NGN",
  "GHS",
  "KES",
  "ZAR",
  "ZMW",
  "UGX",
  "TZS",
  "RWF",
  "XOF",
  "XAF",
  "GBP",
  "EUR",
  "CAD",
] as const;

export type FlutterwaveCurrency = (typeof FLUTTERWAVE_CURRENCIES)[number];

export function resolvePaymentCurrency(code: string): FlutterwaveCurrency {
  const upper = code.toUpperCase();
  return (FLUTTERWAVE_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as FlutterwaveCurrency)
    : "USD";
}
