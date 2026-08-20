import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@legendapp/state/react";

import { LOCAL_PRICES } from "@ekwe/shared/plans";
import { getCurrencySymbol } from "@ekwe/shared/money";
import { getPaymentCurrency } from "@/constants/currency";
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
 * Fetches the worker's public /pricing?currency=<resolved> endpoint. Both the
 * worker and the client resolve the device currency the same way
 * (`getPaymentCurrency()`), and both GET /pricing and POST /billing/checkout
 * price from the same static LOCAL_PRICES map — so the displayed amount is
 * always exactly what the checkout charges, in the same currency.
 *
 * Falls back to the same static LOCAL_PRICES locally when the source is
 * unavailable (offline), so pricing is always deterministic.
 */
export function useActivePricing(): ActivePricingResult {
  const manualCurrency = useSelector(() => settings$.currency.get());
  const currency = getPaymentCurrency(manualCurrency);

  const { data: workerPricing, isPending } = useQuery({
    queryKey: ["workerPricing", currency],
    queryFn: () => fetchWorkerPricing(currency),
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

    const local = LOCAL_PRICES[currency];
    const symbol = getCurrencySymbol(currency);
    return {
      currency,
      symbol,
      monthlyAmount: local.monthly,
      annualAmount: local.annual,
      annualMonthlyCost: +(local.annual / 12).toFixed(2),
      annualSavingPercent: 20,
    };
  }, [workerPricing, currency]);

  return { pricing, isPending };
}