import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef } from "react";
import { useValue } from "@legendapp/state/react";

import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { usePermissions } from "@/hooks/usePermissions";
import { settingsActions, settings$ } from "@/store";
import { DEFAULT_LANGUAGES } from "@/utils/languageUtils";
import { triggerHaptic } from "@/utils/haptics";

export interface UseLanguageSelectionReturn {
  selected: string[];
  toggleLanguage: (code: string) => void;
  isComplete: boolean;
  remaining: number;
  isMaxed: boolean;
}

export function useLanguageSelection(): UseLanguageSelectionReturn {
  const { maxSelectedLanguages } = usePermissions();
  const selected = useValue(() => settings$.selectedLanguages.get());
  const hasInteracted = useRef(false);

  useEffect(() => {
    if (!hasInteracted.current && selected.length === 0) {
      settingsActions.setSelectedLanguages(DEFAULT_LANGUAGES);
    }
  }, [selected.length]);

  const commitToggle = useCallback(
    (code: string): void => {
      const prev = settings$.selectedLanguages.peek();
      if (prev.includes(code)) {
        settingsActions.setSelectedLanguages(prev.filter((c) => c !== code));
      } else if (prev.length >= maxSelectedLanguages) {
        return;
      } else {
        settingsActions.setSelectedLanguages([...prev, code]);
      }
    },
    [maxSelectedLanguages],
  );

  const debouncedToggle = useDebouncedCallback(commitToggle, 200);

  const toggleLanguage = useCallback(
    (code: string): void => {
      const prev = settings$.selectedLanguages.peek();
      hasInteracted.current = true;
      if (prev.includes(code)) {
        triggerHaptic();
      } else if (prev.length >= maxSelectedLanguages) {
        triggerHaptic(Haptics.NotificationFeedbackType.Warning);
        return;
      } else {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      }
      debouncedToggle(code);
    },
    [debouncedToggle, maxSelectedLanguages],
  );

  const isComplete = selected.length === maxSelectedLanguages;
  const remaining = Math.max(0, maxSelectedLanguages - selected.length);
  const isMaxed = selected.length >= maxSelectedLanguages;

  return {
    selected,
    toggleLanguage,
    isComplete,
    remaining,
    isMaxed,
  };
}
