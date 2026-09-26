import {
  countrySummaryForCurrency,
  FLUTTERWAVE_CURRENCIES,
} from "@ekwe/shared/money";

export const MANUAL_CURRENCY_OPTIONS = FLUTTERWAVE_CURRENCIES;

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "United States",
  NGN: "Nigeria",
  GHS: "Ghana",
  KES: "Kenya",
  ZAR: "South Africa",
  ZMW: "Zambia",
  UGX: "Uganda",
  TZS: "Tanzania",
  RWF: "Rwanda",
  XOF: countrySummaryForCurrency("XOF"),
  XAF: countrySummaryForCurrency("XAF"),
  GBP: "United Kingdom",
  EUR: "Eurozone",
  CAD: "Canada",
};
