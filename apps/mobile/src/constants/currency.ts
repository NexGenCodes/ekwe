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

import { countrySummaryForCurrency } from "@ekwe/shared/money";

export const CURRENCY_NAMES: Record<string, string> = {
  NGN: "Nigeria",
  USD: "United States",
  GHS: "Ghana",
  KES: "Kenya",
  ZAR: "South Africa",
  GBP: "United Kingdom",
  EUR: "European Union",
  XOF: countrySummaryForCurrency("XOF"),
};
