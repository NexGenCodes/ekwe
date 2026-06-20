import { useSelector } from "@legendapp/state/react";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  useSharedValue,
  withTiming,
  SharedValue,
} from "react-native-reanimated";

import { settings$ } from "@/store";
import { DEFAULT_LANGUAGES } from "@/utils/languageUtils";
import { triggerHaptic } from "@/utils/haptics";

export type DropdownType = "source" | "target" | null;

interface UseLanguageSwitcherProps {
  sourceLang: string;
  targetLang: string;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;
}

interface LanguageSwitcherReturn {
  activeDropdown: DropdownType;
  myLanguages: string[];
  swapRotation: SharedValue<number>;
  dropdownScale: SharedValue<number>;
  dropdownOpacity: SharedValue<number>;
  handleSelect: (code: string) => void;
  openDropdown: (type: DropdownType) => void;
  closeDropdown: () => void;
}

function findReplacement(myLanguages: string[], exclude: string): string {
  return myLanguages.find((l) => l !== exclude) || "";
}

export function useLanguageSwitcher({
  sourceLang,
  targetLang,
  onSourceChange,
  onTargetChange,
}: UseLanguageSwitcherProps): LanguageSwitcherReturn {
  const storedLanguages = useSelector(() => settings$.selectedLanguages.get()) || [];
  const myLanguages = (storedLanguages.length > 0 ? storedLanguages : DEFAULT_LANGUAGES) as string[];

  const myLanguagesRef = useRef(myLanguages);
  myLanguagesRef.current = myLanguages;

  const [activeDropdown, setActiveDropdown] = useState<DropdownType>(null);

  const swapRotation = useSharedValue(0);
  const dropdownScale = useSharedValue(0.8);
  const dropdownOpacity = useSharedValue(0);

  useEffect(() => {
    if (activeDropdown) {
      dropdownScale.value = withTiming(1, { duration: 150 });
      dropdownOpacity.value = withTiming(1, { duration: 150 });
    } else {
      dropdownScale.value = 0.95;
      dropdownOpacity.value = withTiming(0, { duration: 100 });
    }
  }, [activeDropdown, dropdownScale, dropdownOpacity]);

  const handleSelect = useCallback(
    (code: string) => {
      triggerHaptic();
      const langs = myLanguagesRef.current;

      if (activeDropdown === "source") {
        onSourceChange(code);

        // Handle Collision: Source picked a language that is already Target
        if (code !== "auto" && code === targetLang) {
          // Can we swap the old source to target?
          // Only if old source wasn't 'auto' and wasn't blank.
          if (sourceLang !== "auto" && sourceLang !== "") {
            onTargetChange(sourceLang);
          } else {
            // Pick the next available language from the user's list
            onTargetChange(findReplacement(langs, code));
          }
        }
      } else {
        onTargetChange(code);

        // Handle Collision: Target picked a language that is already Source
        if (code === sourceLang) {
          // Can we swap the old target to source?
          // Target is never 'auto', so yes, as long as it's not blank.
          if (targetLang !== "") {
            onSourceChange(targetLang);
          } else {
            // Pick the next available language from the user's list
            onSourceChange(findReplacement(langs, code));
          }
        }
      }
      setActiveDropdown(null);
    },
    [activeDropdown, sourceLang, targetLang, onSourceChange, onTargetChange],
  );

  const openDropdown = useCallback((type: DropdownType): void => {
    setActiveDropdown(type);
  }, []);

  const closeDropdown = useCallback(() => {
    setActiveDropdown(null);
  }, []);

  return {
    activeDropdown,
    myLanguages,
    swapRotation,
    dropdownScale,
    dropdownOpacity,
    handleSelect,
    openDropdown,
    closeDropdown,
  };
}
