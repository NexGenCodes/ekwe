import { useValue } from "@legendapp/state/react";
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  useSharedValue,
  withTiming,
  SharedValue,
} from "react-native-reanimated";

import { usePermissions } from "@/hooks/usePermissions";
import { settings$ } from "@/store";
import {
  DEFAULT_LANGUAGES,
  sanitizeLanguageCodes,
} from "@/utils/languageUtils";
import { triggerHaptic } from "@/utils/haptics";

export type DropdownType = "source" | "target" | null;

interface UseLanguageSwitcherProps {
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

export function useLanguageSwitcher({
  onSourceChange,
  onTargetChange,
}: UseLanguageSwitcherProps): LanguageSwitcherReturn {
  const { maxSelectedLanguages } = usePermissions();
  const storedLanguages = useValue(() => settings$.selectedLanguages.get());
  const myLanguages = useMemo(() => {
    const codes =
      storedLanguages && storedLanguages.length > 0
        ? storedLanguages
        : DEFAULT_LANGUAGES;
    return sanitizeLanguageCodes(codes, maxSelectedLanguages);
  }, [storedLanguages, maxSelectedLanguages]);

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

      if (activeDropdown === "source") {
        onSourceChange(code);
      } else {
        onTargetChange(code);
      }
      setActiveDropdown(null);
    },
    [activeDropdown, onSourceChange, onTargetChange],
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
