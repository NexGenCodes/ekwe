import { Platform } from "react-native";

import {
  PaymentProvider,
  PaymentFeatureFlags,
  DEFAULT_FEATURE_FLAGS,
  getAvailableProviders,
  getEffectiveProvider,
} from "@ekwe/shared/billing";
import { auth$ } from "@/store";
import { getWorkerUrl } from "@/utils/http";
import logger from "@/utils/logger";
import { createSyncedQuery } from "@/hooks/core/useSyncedQuery";

const ENV_DEFAULT_PROVIDER = process.env.EXPO_PUBLIC_DEFAULT_PROVIDER;

function applyEnvOverride(flags: PaymentFeatureFlags): PaymentFeatureFlags {
  if (ENV_DEFAULT_PROVIDER !== "flutterwave") {
    return flags;
  }
  return {
    ...flags,
    default_provider: "flutterwave",
    flutterwave_enabled: true,
  };
}

export interface UsePaymentProviderReturn {
  provider: PaymentProvider | null;
  availableProviders: PaymentProvider[];
  featureFlags: PaymentFeatureFlags;
  isLoading: boolean;
  isFlutterwave: boolean;
}

const featureFlagsQuery = createSyncedQuery<PaymentFeatureFlags>(
  "ekwe_billing_feature_flags",
  async () => {
    const session = auth$.session.get();
    if (!session) return DEFAULT_FEATURE_FLAGS;

    try {
      const base = getWorkerUrl();
      if (!base) return DEFAULT_FEATURE_FLAGS;

      const res = await fetch(`${base}/billing/flags`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (res.ok) {
        return (await res.json()) as PaymentFeatureFlags;
      }
    } catch (err) {
      logger.warn("[PaymentProvider] Failed to fetch feature flags", err);
    }
    return DEFAULT_FEATURE_FLAGS;
  },
);

export const featureFlags$ = featureFlagsQuery.query$;

export function usePaymentProvider(): UsePaymentProviderReturn {
  const { data, isLoading } = featureFlagsQuery.useQuery();

  const flags = applyEnvOverride(data ?? DEFAULT_FEATURE_FLAGS);
  const platform = Platform.OS as "ios" | "android" | "web";
  const availableProviders = getAvailableProviders(flags, platform);
  const provider = getEffectiveProvider(flags, platform);

  return {
    provider,
    availableProviders,
    featureFlags: flags,
    isLoading,
    isFlutterwave: provider === "flutterwave",
  };
}
