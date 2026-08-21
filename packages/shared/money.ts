/**
 * Currency helpers built on Intl (ECMA-402) plus the ISO 4217 country →
 * currency dataset from `countries-list`, with no hand-maintained currency
 * table. Both Hermes (mobile) and Cloudflare Workers ship full
 * Intl.NumberFormat support; decimals and symbols come from Unicode CLDR, so
 * any ISO 4217 code the stores bill in is supported.
 */
import { countries } from "countries-list";

/**
 * Returns the number of minor units for a currency (USD → 2, JPY → 0, XOF → 0).
 * Unknown/invalid codes fall back to 2.
 */
export function getDecimals(code: string): number {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).formatToParts(1.23);
    const fraction = parts.find((p) => p.type === "fraction");
    return fraction ? fraction.value.length : 0;
  } catch {
    return 2;
  }
}

/**
 * Returns the currency symbol, preferring the device locale (the currency is
 * device-derived, so the locale matches the region and CLDR can emit the local
 * glyph, e.g. ₦ from en-NG). Falls back to the code or "$".
 */
export function getCurrencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || "$";
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

export function formatMoney(amount: number, code: string): string {
  const symbol = getCurrencySymbol(code);
  return `${symbol}${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Maps an ISO 3166-1 alpha-2 country code (case-insensitive) to its primary
 * ISO 4217 currency, sourced from the `countries-list` dataset — the same
 * authoritative source `languages.ts` uses, so nothing here is hand-maintained.
 * Used to derive the billing currency from the device *region*:
 * `expo-localization` only reliably reports a region (`regionCode`), while
 * `currencyCode` follows the language tag on Android (e.g. an English-US
 * phone in Nigeria reports USD). Returns undefined for unknown countries so
 * callers can fall back to a platform currency code as a secondary signal.
 */
export function countryToCurrency(countryCode: string): string | undefined {
  const country =
    countries[countryCode.toUpperCase() as keyof typeof countries];
  return country?.currency?.[0];
}

/**
 * Currencies we accept as a charge currency on Flutterwave. Flutterwave does
 * NOT auto-convert: the merchant must send the `amount` + `currency`, and the
 * customer's card is charged in that currency (Flutterwave converts the card's
 * own currency, not ours). We therefore only bill in currencies Flutterwave
 * supports, and we publish a hand-set static price for each in
 * `./plans.ts` (`LOCAL_PRICES`). Anything outside this set falls back to USD.
 */
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

/**
 * Normalizes an ISO-4217 code to a Flutterwave-billable currency. Unsupported
 * or unknown codes resolve to USD (our global default) so pricing and checkout
 * are always deterministic — display == charge in the same currency.
 */
export function resolvePaymentCurrency(code: string): FlutterwaveCurrency {
  const upper = code.toUpperCase();
  return (FLUTTERWAVE_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as FlutterwaveCurrency)
    : "USD";
}
