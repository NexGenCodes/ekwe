/**
 * ─── usePaymentProvider Hook ─────────────────────────────────────
 *
 * Determines which payment provider is active for the current user/platform.
 * Fetches feature flags from the Worker (which reads from the payment_config
 * table) and returns the effective provider based on:
 *
 *   1. Platform constraints (Flutterwave works on all platforms)
 *   2. Feature flag state (provider enabled/disabled)
 *   3. default_provider (developer-only, set via payment_config)
 *
 * Provider selection is developer-controlled — there is no user-facing toggle
 * and no persisted user preference.
 */

import { Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  PaymentProvider,
  PaymentFeatureFlags,
  DEFAULT_FEATURE_FLAGS,
  getAvailableProviders,
  getEffectiveProvider,
} from "@ekwe/shared/billing";
import { mmkv } from "@/services/mmkv";
import { auth$ } from "@/store";
import { getWorkerUrl } from "@/utils/networkUtils";
import logger from "@/utils/logger";

// ─── Constants ───────────────────────────────────────────────────

const FLAGS_CACHE_KEY = "ekwe_billing_feature_flags";
const FLAGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Env Override ────────────────────────────────────────────────
// EXPO_PUBLIC_DEFAULT_PROVIDER lets a developer force a payment provider
// from the local .env (e.g. EXPO_PUBLIC_DEFAULT_PROVIDER=flutterwave) without
// editing the payment_config row in Supabase. It overrides the server's
// default_provider AND force-enables that provider so the switch always
// takes effect, even if the DB row has it disabled.
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

// ─── Types ───────────────────────────────────────────────────────

export interface UsePaymentProviderReturn {
  /** The currently selected payment provider (null if none available). */
  provider: PaymentProvider | null;
  /** All providers available on this platform. */
  availableProviders: PaymentProvider[];
  /** Feature flags from the server. */
  featureFlags: PaymentFeatureFlags;
  /** True while fetching feature flags from the server. */
  isLoading: boolean;
  /** True if Flutterwave is the selected or only provider. */
  isFlutterwave: boolean;
}

// ─── API Call ────────────────────────────────────────────────────

async function fetchFeatureFlags(): Promise<PaymentFeatureFlags> {
  const session = auth$.session.get();
  if (!session) return DEFAULT_FEATURE_FLAGS;

  // Try fetching from the Worker (which reads payment_config table)
  try {
    const base = getWorkerUrl();
    if (!base) return DEFAULT_FEATURE_FLAGS;

    const res = await fetch(`${base}/billing/flags`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (res.ok) {
      const flags = (await res.json()) as PaymentFeatureFlags;
      // Cache the flags locally
      mmkv.set(
        FLAGS_CACHE_KEY,
        JSON.stringify({
          ...flags,
          _cachedAt: Date.now(),
        }),
      );
      return flags;
    }
  } catch (err) {
    logger.warn("[PaymentProvider] Failed to fetch feature flags", err);
  }

  // Fall back to cached flags
  try {
    const cached = mmkv.getString(FLAGS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as PaymentFeatureFlags & { _cachedAt: number };
      if (Date.now() - parsed._cachedAt < FLAGS_CACHE_TTL) {
        return {
          flutterwave_enabled: parsed.flutterwave_enabled,
          default_provider: parsed.default_provider,
        };
      }
    }
  } catch {
    // Ignore cache errors
  }

  return DEFAULT_FEATURE_FLAGS;
}

// ─── Hook ────────────────────────────────────────────────────────

export function usePaymentProvider(): UsePaymentProviderReturn {
  // Fetch feature flags from server
  const { data: featureFlags, isLoading } = useQuery({
    queryKey: ["paymentFeatureFlags"],
    queryFn: fetchFeatureFlags,
    staleTime: FLAGS_CACHE_TTL,
    retry: 1,
  });

  const flags = applyEnvOverride(featureFlags ?? DEFAULT_FEATURE_FLAGS);
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
