import { useSelector } from '@legendapp/state/react';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  useAnimatedStyle,
} from 'react-native-reanimated';

import { LanguageDropdown } from '../LanguageDropdown';
import { LanguagePill } from '../LanguagePill';
import { SwapButton } from './SwapButton';

import { PLAN_LIMITS } from '@/constants/billing';
import { borderRadius, spacing } from '@/constants/designTokens';
import { useTheme, useLanguageSwitcher } from '@/hooks';
import { auth$ } from '@/store';

interface LanguageSwitcherProps {
  sourceLang: string;
  targetLang: string;
  onSwap: () => void;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;
}

export function LanguageSwitcher({
  sourceLang,
  targetLang,
  onSwap,
  onSourceChange,
  onTargetChange,
}: LanguageSwitcherProps): React.ReactElement {
  const { color } = useTheme();

  const {
    activeDropdown,
    myLanguages,
    swapRotation,
    dropdownScale,
    dropdownOpacity,
    handleSelect,
    openDropdown,
    closeDropdown,
  } = useLanguageSwitcher({
    sourceLang,
    targetLang,
    onSourceChange,
    onTargetChange,
  });

  const animatedDropdownStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: dropdownScale.value }],
      opacity: dropdownOpacity.value,
    };
  });

  const isPro = useSelector(() => auth$.isPro.get());
  const canUseAuto = isPro
    ? PLAN_LIMITS.pro.autoLanguageDetect
    : PLAN_LIMITS.free.autoLanguageDetect;

  const sourceOptions = canUseAuto ? ['auto', ...myLanguages] : myLanguages;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: color.surface, borderColor: color.border },
      ]}
    >
      <LanguageDropdown
        visible={!!activeDropdown}
        onClose={closeDropdown}
        options={activeDropdown === 'source' ? sourceOptions : myLanguages}
        currentLang={activeDropdown === 'source' ? sourceLang : targetLang}
        oppositeLang={activeDropdown === 'source' ? targetLang : sourceLang}
        onSelect={handleSelect}
        animatedStyle={animatedDropdownStyle}
        showAutoLocked={activeDropdown === 'source' && !canUseAuto}
      />

      <LanguagePill
        langCode={sourceLang}
        onPress={() => openDropdown('source')}
      />

      <SwapButton
        sourceLang={sourceLang}
        targetLang={targetLang}
        onSwap={onSwap}
        swapRotation={swapRotation}
      />

      <LanguagePill
        langCode={targetLang}
        onPress={() => openDropdown('target')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 100,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
});
