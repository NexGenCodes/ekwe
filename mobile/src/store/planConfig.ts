import { observable } from "@legendapp/state";
import { persistObservable } from "@legendapp/state/persist";

import { PLAN_LIMITS } from "@/constants/billing";
import type { PlanLimits } from "@/constants/billing";
import { ObservablePersistMMKV } from "@/store/mmkvPlugin";
import { auth$ } from "./auth";

interface PriceDetail {
  amount: number;
  currency: string;
  lowestUnit: number;
}

interface PlanPricing {
  monthly: PriceDetail;
  annual: PriceDetail;
}

export interface PlanConfigResponse {
  limits: {
    FREE: PlanLimits;
    PREMIUM: PlanLimits;
  };
  features: {
    FREE: Record<string, boolean>;
    PREMIUM: Record<string, boolean>;
  };
  pricing: Record<string, PlanPricing>;
}

interface PlanConfigState {
  config: PlanConfigResponse | null;
  lastFetched: number | null;
}

const initialState: PlanConfigState = {
  config: null,
  lastFetched: null,
};

export const planConfig$ = observable<PlanConfigState>(initialState);

persistObservable(planConfig$.config, {
  local: "ekwe-plan-config",
  pluginLocal: ObservablePersistMMKV,
});

export const planConfigActions = {
  setConfig: (config: PlanConfigResponse): void => {
    planConfig$.config.set(config);
    planConfig$.lastFetched.set(Date.now());
  },

  getLimits: (): PlanLimits => {
    const config = planConfig$.config.get();
    const isPro = auth$.isPro.get();

    if (config) {
      return isPro ? config.limits.PREMIUM : config.limits.FREE;
    }

    return isPro ? PLAN_LIMITS.pro : PLAN_LIMITS.free;
  },

  clearConfig: (): void => {
    planConfig$.config.set(null);
    planConfig$.lastFetched.set(null);
  },
};
