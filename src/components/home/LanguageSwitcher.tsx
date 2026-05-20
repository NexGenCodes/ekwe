import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { ArrowRightLeft } from 'lucide-react-native';
import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { LanguageDropdown } from '../LanguageDropdown';
import { LanguagePill } from '../LanguagePill';

import { PLAN_LIMITS } from '@/constants/billing';
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

  const animatedSwapStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${swapRotation.value}deg` }],
    };
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
    <View style={styles.container}>
      <LanguageDropdown
        visible={!!activeDropdown}
        onClose={closeDropdown}
        options={activeDropdown === 'source' ? sourceOptions : myLanguages}
        currentLang={activeDropdown === 'source' ? sourceLang : targetLang}
        oppositeLang={activeDropdown === 'source' ? targetLang : sourceLang}
        onSelect={handleSelect}
        animatedStyle={animatedDropdownStyle}
      />

      <LanguagePill
        langCode={sourceLang}
        onPress={() => openDropdown('source')}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Swap languages"
        onPress={async () => {
          if (sourceLang === 'auto') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }
          swapRotation.value = withTiming(swapRotation.value + 180, {
            duration: 250,
          });
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onSwap();
        }}
        style={({ pressed }) => [
          styles.swapBtn,
          { backgroundColor: color.primary },
          (pressed || sourceLang === 'auto') && { opacity: 0.5 },
          pressed && sourceLang !== 'auto' && { transform: [{ scale: 0.9 }] },
        ]}
      >
        <Animated.View style={animatedSwapStyle}>
          <ArrowRightLeft size={18} color={color.onPrimary} strokeWidth={2.5} />
        </Animated.View>
      </Pressable>

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
  },
  swapBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
});
