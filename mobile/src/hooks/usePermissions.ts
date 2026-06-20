import { useSelector } from "@legendapp/state/react";
import { useMemo } from "react";

import { PLAN_FEATURES, PLAN_LIMITS } from "@/constants/billing";
import { auth$ } from "@/store";

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

  const limits = isPro ? PLAN_LIMITS.pro : PLAN_LIMITS.free;

  return useMemo(() => ({
    maxPinnedLanguages: HARDCODED_LIMITS.maxPinnedLanguages,
    maxSelectedLanguages: HARDCODED_LIMITS.maxSelectedLanguages,
    dictationDurationMs: limits.dictationDurationMs,
    historyLocalTtlDays: HARDCODED_LIMITS.historyLocalTtlDays,
    historyRemoteTtlDays: limits.historyRemoteTtlDays,
    textTranslationMaxChars: limits.maxTextChars,
    autoLanguageDetect: limits.autoDetectAllowed,
    customAvatarIcons: limits.customAvatarIcons,
    autoCopy: isPro
      ? PLAN_FEATURES.pro.autoCopy
      : PLAN_FEATURES.free.autoCopy,
    contextAwareness: limits.contextAwareness,
  }), [isPro, limits]);
}
