import { useSelector } from "@legendapp/state/react";
import { useMemo } from "react";

import { DISPLAY_PRICING } from "@/constants/billing";
import { getCurrency } from "@ekwe/shared/currencies";
import { computeSavingPercent } from "@ekwe/shared/money";
import { usePricingQuery } from "@/hooks/queries/usePricingQuery";
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
  /** True while the server pricing query is in flight and no data is cached. */
  isPending: boolean;
}

/**
 * Single source of truth for the price the billing screen shows.
 *
 * Prefers server pricing for the active currency and falls back to the
 * DISPLAY_PRICING table when the query has no data yet (cold start or
 * offline). React Query dedupes the fetch, so calling this hook from
 * several components is free and keeps the price math in one place.
 */
export function useActivePricing(): ActivePricingResult {
  const currency = useSelector(() => settings$.currency.get());
  const { data: pricingData, isPending } = usePricingQuery();

  const pricing = useMemo<ActivePricing>(() => {
    const serverPricing =
      pricingData?.pricing?.[currency] ?? pricingData?.pricing?.USD;
    if (serverPricing) {
      const cur = serverPricing.monthly.currency;
      const symbol = getCurrency(cur)?.symbol ?? "$";
      const monthlyAmount = serverPricing.monthly.amount;
      const annualAmount = serverPricing.annual.amount;
      return {
        currency: cur,
        symbol,
        monthlyAmount,
        annualAmount,
        annualMonthlyCost: +(annualAmount / 12).toFixed(2),
        annualSavingPercent: computeSavingPercent(monthlyAmount, annualAmount),
      };
    }

    const fallback = DISPLAY_PRICING[currency] || DISPLAY_PRICING.USD;
    return {
      currency: fallback.monthly.currency,
      symbol: fallback.monthly.symbol,
      monthlyAmount: fallback.monthly.amount,
      annualAmount: fallback.annual.amount,
      annualMonthlyCost: fallback.annualMonthlyCost,
      annualSavingPercent: fallback.annualSavingPercent,
    };
  }, [currency, pricingData]);

  return { pricing, isPending };
}
