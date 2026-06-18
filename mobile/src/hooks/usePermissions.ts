import { useSelector } from "@legendapp/state/react";
import { useMemo } from "react";

import { usePlanConfigQuery } from "@/hooks/queries/usePlanConfigQuery";
import { auth$ } from "@/store";

/**
 * Centralized Role Management Hook
 *
 * Extracts the user's active permissions based on their verified tier.
 * This prevents role-checking logic from being scattered across components
 * and ensures that limit values are strictly tied to the live config source of truth.
 *
 * Note on Client Security:
 * Even if a user alters local MMKV storage to force `isPro: true`, they only
 * unlock the UI frontend. The Cloudflare Worker validates their tier securely
 * via the signed Supabase JWT payload and enforces 2MB audio limits & rate caps.
 */
interface PlanLimits {
  maxPinnedLanguages: number;
  maxSelectedLanguages: number;
  dictationDurationMs: number;
  historyLocalTtlDays: number;
  historyRemoteTtlDays: number;
  textTranslationMaxChars: number;
  autoLanguageDetect: boolean;
  customAvatarIcons: boolean;
  autoCopy: boolean;
  contextAwareness: boolean;
}

const HARDCODED_LIMITS = {
  maxPinnedLanguages: 5,
  maxSelectedLanguages: 10,
  historyLocalTtlDays: 90,
};

export function usePermissions(): PlanLimits {
  const isPro = useSelector(() => auth$.isPro.get());
  const { data: config } = usePlanConfigQuery();

  return useMemo(() => {
    const limits = config
      ? (isPro ? config.limits.PREMIUM : config.limits.FREE)
      : undefined;

    return {
      maxPinnedLanguages: HARDCODED_LIMITS.maxPinnedLanguages,
      maxSelectedLanguages: HARDCODED_LIMITS.maxSelectedLanguages,
      dictationDurationMs: limits?.dictationDurationMs ?? 120_000,
      historyLocalTtlDays: HARDCODED_LIMITS.historyLocalTtlDays,
      historyRemoteTtlDays: limits?.historyRemoteTtlDays ?? 30,
      textTranslationMaxChars: limits?.maxTextChars ?? 3_000,
      autoLanguageDetect: limits?.autoDetectAllowed ?? false,
      customAvatarIcons: limits?.customAvatarIcons ?? false,
      autoCopy: config
        ? (isPro ? config.features.PREMIUM : config.features.FREE).autoCopy ?? true
        : true,
      contextAwareness: limits?.contextAwareness ?? false,
    };
  }, [isPro, config]);
}
