import { useMemo } from "react";
import { observable, syncState } from "@legendapp/state";
import type { ObservableParam } from "@legendapp/state";
import { synced } from "@legendapp/state/sync";
import type { Synced } from "@legendapp/state/sync";
import { useValue } from "@legendapp/state/react";

import { LOCAL_PRICES } from "@ekwe/shared/plans";
import {
  getCurrencySymbol,
  isSupportedPaymentCurrency,
  resolvePaymentCurrency,
} from "@ekwe/shared/money";
import type { FlutterwaveCurrency } from "@ekwe/shared/money";
import { fetchWorkerPricing } from "@/services/pricing";
import { settings$ } from "@/store";
import { mmkvPlugin } from "@/store/mmkvPlugin";
import type { StorePricingResponse } from "@ekwe/shared";

export interface ActivePricing {
  currency: FlutterwaveCurrency;
  symbol: string;
  monthlyAmount: number;
  annualAmount: number;
  annualMonthlyCost: number;
  annualSavingPercent: number;
}

export interface ActivePricingResult {
  pricing: ActivePricing;
  isPending: boolean;
}

const pricingCache$ = observable<
  Record<string, Synced<StorePricingResponse | undefined>>
>({});

function getPricingObs(
  currency: FlutterwaveCurrency,
): ObservableParam<Synced<StorePricingResponse | undefined>> {
  if (!pricingCache$[currency].peek()) {
    pricingCache$[currency].set(
      synced({
        get: () => fetchWorkerPricing(currency),
        persist: {
          name: `pricing-cache-${currency}`,
          plugin: mmkvPlugin,
        },
      }),
    );
  }
  return pricingCache$[currency];
}

export function useActivePricing(): ActivePricingResult {
  const manualCurrency = useValue(() => settings$.currency.get());

  const pricingObs = getPricingObs(manualCurrency);
  const workerPricing = useValue(pricingObs) as
    StorePricingResponse | undefined;
  const syncStatus = useValue(syncState(pricingObs));

  const pricing = useMemo<ActivePricing>(() => {
    if (isValidPricing(workerPricing)) {
      const valid = workerPricing;
      const currency = resolvePaymentCurrency(valid.currency);
      const symbol = getCurrencySymbol(currency);
      return {
        currency,
        symbol,
        monthlyAmount: valid.price,
        annualAmount: valid.annualPrice,
        annualMonthlyCost: +(valid.annualPrice / 12).toFixed(2),
        annualSavingPercent: valid.annualDiscountPercent,
      };
    }

    const currency = manualCurrency;
    const local = LOCAL_PRICES[currency];
    return {
      currency,
      symbol: getCurrencySymbol(currency),
      monthlyAmount: local.monthly,
      annualAmount: local.annual,
      annualMonthlyCost: +(local.annual / 12).toFixed(2),
      annualSavingPercent: 20,
    };
  }, [workerPricing, manualCurrency]);

  return { pricing, isPending: syncStatus.isGetting ?? false };
}

function isValidPricing(value: unknown): value is StorePricingResponse {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<Record<keyof StorePricingResponse, unknown>>;
  return (
    typeof p.currency === "string" &&
    isSupportedPaymentCurrency(p.currency) &&
    typeof p.price === "number" &&
    Number.isFinite(p.price) &&
    typeof p.annualPrice === "number" &&
    Number.isFinite(p.annualPrice) &&
    typeof p.annualDiscountPercent === "number" &&
    Number.isFinite(p.annualDiscountPercent)
  );
}
