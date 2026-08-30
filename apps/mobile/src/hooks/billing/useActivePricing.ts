import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@legendapp/state/react";

import { LOCAL_PRICES } from "@ekwe/shared/plans";
import { getCurrencySymbol, resolvePaymentCurrency } from "@ekwe/shared/money";
import { fetchWorkerPricing } from "@/services/pricing";
import { settings$ } from "@/store";

export interface ActivePricing {
  currency: string;
  symbol: string;
  monthlyAmount: number;
  annualAmount: number;
  annualMonthlyCost: number;
  annualSavingPercent: number;
}

export interface ActivePricingResult {
  pricing: ActivePricing;
  /** True while the pricing query is in flight and no data is cached. */
  isPending: boolean;
}

/**
 * Single source of truth for the price the billing screen shows, matching the
 * amount Flutterwave will actually charge.
 *
 * Only a manual currency selection is sent to the worker. When none is set,
 * `currency` is omitted so the worker resolves it authoritatively from the
 * request geo (Cloudflare CF-IPCountry) — avoiding the Android locale quirk
 * that misreports region (e.g. an English-US phone in Nigeria resolving to
 * USD). /billing/checkout applies the exact same resolution, so the displayed
 * amount always equals what the checkout charges, in the same currency.
 *
 * Falls back to the same static LOCAL_PRICES locally when the source is
 * unavailable (offline), so pricing is always deterministic.
 */
export function useActivePricing(): ActivePricingResult {
  const manualCurrency = useSelector(() => settings$.currency.get());
  const queryCurrency = manualCurrency ?? undefined;

  const { data: workerPricing, isPending } = useQuery({
    queryKey: ["workerPricing", queryCurrency ?? "auto"],
    queryFn: () => fetchWorkerPricing(queryCurrency),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const pricing = useMemo<ActivePricing>(() => {
    if (workerPricing) {
      const symbol = getCurrencySymbol(workerPricing.currency);
      return {
        currency: workerPricing.currency,
        symbol,
        monthlyAmount: workerPricing.price,
        annualAmount: workerPricing.annualPrice,
        annualMonthlyCost: +(workerPricing.annualPrice / 12).toFixed(2),
        annualSavingPercent: workerPricing.annualDiscountPercent,
      };
    }

    const local = LOCAL_PRICES[resolvePaymentCurrency(queryCurrency ?? "USD")];
    const currency = resolvePaymentCurrency(queryCurrency ?? "USD");
    const symbol = getCurrencySymbol(currency);
    return {
      currency,
      symbol,
      monthlyAmount: local.monthly,
      annualAmount: local.annual,
      annualMonthlyCost: +(local.annual / 12).toFixed(2),
      annualSavingPercent: 20,
    };
  }, [workerPricing, queryCurrency]);

  return { pricing, isPending };
}
