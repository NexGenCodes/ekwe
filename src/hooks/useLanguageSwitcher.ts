import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { useState, useCallback, useEffect } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { settings$ } from '@/store';

export type DropdownType = 'source' | 'target' | null;

interface UseLanguageSwitcherProps {
  sourceLang: string;
  targetLang: string;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;
}

export function useLanguageSwitcher({
  sourceLang,
  targetLang,
  onSourceChange,
  onTargetChange,
}: UseLanguageSwitcherProps) {
  const myLanguages =
    useSelector(() => settings$.selectedLanguages.get()) || [];

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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (activeDropdown === 'source') {
        onSourceChange(code);
        if (code !== 'auto' && code === targetLang) {
          const fallback = myLanguages.find((l) => l !== code);
          if (fallback) onTargetChange(fallback);
        }
      } else {
        onTargetChange(code);
        if (code === sourceLang) {
          if (sourceLang !== 'auto') {
            const fallback = myLanguages.find((l) => l !== code);
            onSourceChange(fallback ?? 'auto');
          }
        }
      }
      setActiveDropdown(null);
    },
    [
      activeDropdown,
      sourceLang,
      targetLang,
      myLanguages,
      onSourceChange,
      onTargetChange,
    ],
  );

  const openDropdown = useCallback((type: DropdownType) => {
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
