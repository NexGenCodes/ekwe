import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";

import { settings$ } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

const MAX_LANGUAGES = 5;

export interface UseLanguageSelectionReturn {
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  toggleLanguage: (code: string) => void;
  isComplete: boolean;
  remaining: number;
  isMaxed: boolean;
}

export function useLanguageSelection(): UseLanguageSelectionReturn {
  const [selected, setSelected] = useState<string[]>(() =>
    settings$.selectedLanguages.get(),
  );

  const toggleLanguage = useCallback((code: string): void => {
    setSelected((prev) => {
      if (prev.includes(code)) {
        triggerHaptic();
        return prev.filter((c) => c !== code);
      }
      if (prev.length >= MAX_LANGUAGES) {
        triggerHaptic(Haptics.NotificationFeedbackType.Warning);
        return prev;
      }
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      return [...prev, code];
    });
  }, []);

  const isComplete = selected.length > 0;
  const remaining = MAX_LANGUAGES - selected.length;
  const isMaxed = selected.length >= MAX_LANGUAGES;

  return {
    selected,
    setSelected,
    toggleLanguage,
    isComplete,
    remaining,
    isMaxed,
  };
}
