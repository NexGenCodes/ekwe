import { useSelector } from "@legendapp/state/react";
import { useMemo } from "react";

import { PLAN_LIMITS } from "@/constants/billing";
import { auth$ } from "@/store";

/**
 * Centralized Role Management Hook
 *
 * Extracts the user's active permissions based on their verified tier.
 * This prevents role-checking logic from being scattered across components
 * and ensures that limit values are strictly tied to the PLAN_LIMITS source of truth.
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

export function usePermissions(): PlanLimits {
  // We use Legend-State to reactively track the user's pro status.
  // This is set securely on login via session.user.app_metadata.is_pro
  const isPro = useSelector(() => auth$.isPro.get());

  return useMemo(() => {
    return isPro ? PLAN_LIMITS.pro : PLAN_LIMITS.free;
  }, [isPro]);
}
