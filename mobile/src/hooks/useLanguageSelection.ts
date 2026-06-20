import * as Haptics from "expo-haptics";
import { useCallback, useEffect } from "react";
import { useSelector } from "@legendapp/state/react";

import { LANGUAGES } from "@/constants/languages";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { settingsActions, settings$ } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

const MAX_LANGUAGES = 5;
const DEFAULT_LANGUAGES = LANGUAGES.filter((l) => l.defaultSelected).map(
  (l) => l.code,
);

export interface UseLanguageSelectionReturn {
  selected: string[];
  toggleLanguage: (code: string) => void;
  isComplete: boolean;
  remaining: number;
  isMaxed: boolean;
}

export function useLanguageSelection(): UseLanguageSelectionReturn {
  const selected = useSelector(() => settings$.selectedLanguages.get());

  useEffect(() => {
    if (selected.length === 0) {
      settingsActions.setSelectedLanguages(DEFAULT_LANGUAGES);
    }
  }, [selected.length]);

  const commitToggle = useCallback((code: string): void => {
    const prev = settings$.selectedLanguages.peek();
    if (prev.includes(code)) {
      settingsActions.setSelectedLanguages(prev.filter((c) => c !== code));
    } else if (prev.length >= MAX_LANGUAGES) {
      return;
    } else {
      settingsActions.setSelectedLanguages([...prev, code]);
    }
  }, []);

  const debouncedToggle = useDebouncedCallback(commitToggle, 200);

  const toggleLanguage = useCallback(
    (code: string): void => {
      const prev = settings$.selectedLanguages.peek();
      if (prev.includes(code)) {
        triggerHaptic();
      } else if (prev.length >= MAX_LANGUAGES) {
        triggerHaptic(Haptics.NotificationFeedbackType.Warning);
        return;
      } else {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      }
      debouncedToggle(code);
    },
    [debouncedToggle],
  );

  const isComplete = selected.length === MAX_LANGUAGES;
  const remaining = MAX_LANGUAGES - selected.length;
  const isMaxed = selected.length >= MAX_LANGUAGES;

  return {
    selected,
    toggleLanguage,
    isComplete,
    remaining,
    isMaxed,
  };
}
