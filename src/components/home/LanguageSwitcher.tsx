import { useSelector } from '@legendapp/state/react';
import React, { useState } from 'react';
import Animated, { useAnimatedStyle, LinearTransition } from 'react-native-reanimated';

import { LanguageDropdown } from './LanguageDropdown';
import { LanguagePill } from './LanguagePill';
import { SwapButton } from './SwapButton';

import { Box } from '@/components/ui';
import { PLAN_LIMITS } from '@/constants/billing';
import { borderRadius, zIndex } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
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
  const [swapped, setSwapped] = useState(false);

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

  const handleSwapClick = React.useCallback(() => {
    setSwapped(s => !s);
    onSwap();
  }, [onSwap]);

  const items = [
    <Animated.View key="source-pill" layout={LinearTransition.springify()} style={{ flex: 1 }}>
      <LanguagePill
        langCode={sourceLang}
        onPress={() => openDropdown('source')}
      />
    </Animated.View>,
    <SwapButton
      key="swap-button"
      sourceLang={sourceLang}
      targetLang={targetLang}
      onSwap={handleSwapClick}
      swapRotation={swapRotation}
    />,
    <Animated.View key="target-pill" layout={LinearTransition.springify()} style={{ flex: 1 }}>
      <LanguagePill
        langCode={targetLang}
        onPress={() => openDropdown('target')}
      />
    </Animated.View>
  ];

  const orderedItems = swapped ? [items[2], items[1], items[0]] : items;

  return (
    <Animated.View
      layout={LinearTransition.springify()}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: zIndex.dropdown,
        borderRadius: borderRadius['2xl'],
        borderWidth: 1,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        backgroundColor: color.background,
        borderColor: color.border,
      }}
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

      {orderedItems}
    </Animated.View>
  );
}
