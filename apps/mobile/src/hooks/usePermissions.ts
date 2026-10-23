import { useValue } from "@legendapp/state/react";
import { useMemo } from "react";

import { PLAN_FEATURES, PLAN_LIMITS } from "@/constants/billing";
import { historyLocalTtlDays } from "@/constants/retention";
import { auth$ } from "@/store";

interface PlanLimits {
  maxSelectedLanguages: number;
  dictationDurationMs: number;
  historyLocalTtlDays: number;
  historyRemoteTtlDays: number;
  textTranslationMaxChars: number;
  autoLanguageDetect: boolean;
  customAvatarIcons: boolean;
  autoCopy: boolean;
  cooldownSeconds: number;
}

export function usePermissions(): PlanLimits {
  const isPro = useValue(() => auth$.isPro.get());

  const limits = isPro ? PLAN_LIMITS.pro : PLAN_LIMITS.free;

  return useMemo(
    () => ({
      maxSelectedLanguages: limits.maxLanguages,
      dictationDurationMs: limits.dictationDurationMs,
      historyLocalTtlDays: historyLocalTtlDays(isPro),
      historyRemoteTtlDays: limits.historyRemoteTtlDays,
      textTranslationMaxChars: limits.maxTextChars,
      autoLanguageDetect: limits.autoDetectAllowed,
      customAvatarIcons: limits.customAvatarIcons,
      autoCopy: isPro
        ? PLAN_FEATURES.pro.autoCopy
        : PLAN_FEATURES.free.autoCopy,
      cooldownSeconds: limits.cooldownSeconds,
    }),
    [isPro, limits],
  );
}
