import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { DISPLAY_PRICING } from "@/constants/billing";
import { detectDeviceCurrency } from "@/constants/currency";
import { getCurrencySymbol } from "@ekwe/shared/money";
import { fetchWorkerPricing } from "@/services/pricing";

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
 * Fetches the worker's public /pricing?currency=<detected> endpoint. The
 * worker prices from subscription_config (USD base + discounts × FX), which
 * is exactly what /billing/checkout charges.
 *
 * Falls back to DISPLAY_PRICING.USD when the source is unavailable.
 */
export function useActivePricing(): ActivePricingResult {
  const { data: workerPricing, isPending } = useQuery({
    queryKey: ["workerPricing", detectDeviceCurrency()],
    queryFn: () => fetchWorkerPricing(detectDeviceCurrency()),
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

    const fallback = DISPLAY_PRICING.USD;
    return {
      currency: fallback.monthly.currency,
      symbol: fallback.monthly.symbol,
      monthlyAmount: fallback.monthly.amount,
      annualAmount: fallback.annual.amount,
      annualMonthlyCost: fallback.annualMonthlyCost,
      annualSavingPercent: fallback.annualSavingPercent,
    };
  }, [workerPricing]);

  return { pricing, isPending };
}
