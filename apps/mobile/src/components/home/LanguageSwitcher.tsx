import React from "react";
import Animated, {
  useAnimatedStyle,
  LinearTransition,
} from "react-native-reanimated";

import { LanguageDropdown } from "@/components/home/LanguageDropdown";
import { LanguagePill } from "@/components/home/LanguagePill";
import { SwapButton } from "@/components/home/SwapButton";

import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useLanguageSwitcher, usePermissions } from "@/hooks";
import { useLockedFeature } from "@/hooks/useLockedFeature";
import { triggerHaptic } from "@/utils/haptics";

interface LanguageSwitcherProps {
  sourceLang: string;
  targetLang: string;
  detectedLanguage?: string | null;
  onSwap: () => void;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;
}

export function LanguageSwitcher({
  sourceLang,
  targetLang,
  detectedLanguage,
  onSwap,
  onSourceChange,
  onTargetChange,
}: LanguageSwitcherProps): React.ReactElement {
  const { color } = useTheme();
  const permissions = usePermissions();

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
    onSourceChange,
    onTargetChange,
  });

  const animatedDropdownStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: dropdownScale.value }],
      opacity: dropdownOpacity.value,
    };
  });

  const gatedOptions = React.useMemo(() => {
    const gates = new Set<string>();
    if (!permissions?.autoLanguageDetect) gates.add("auto");
    return gates;
  }, [permissions?.autoLanguageDetect]);

  const handleLockedPress = useLockedFeature({
    navigateToBilling: true,
    message: "Auto-detect is a Premium feature",
  });

  const handlePressGated = React.useCallback(
    (_code: string): void => {
      closeDropdown();
      handleLockedPress();
    },
    [closeDropdown, handleLockedPress],
  );

  const sourceOptions = React.useMemo(
    () => ["auto", ...myLanguages],
    [myLanguages],
  );

  const sourcePillOnPress = React.useCallback(() => {
    void triggerHaptic();
    openDropdown("source");
  }, [openDropdown]);
  const targetPillOnPress = React.useCallback(() => {
    void triggerHaptic();
    openDropdown("target");
  }, [openDropdown]);

  const items = React.useMemo(
    () => [
      <Animated.View
        key="source-pill"
        layout={LinearTransition.springify()}
        style={{ flex: 1 }}
      >
        <LanguagePill
          langCode={sourceLang}
          detectedLanguage={detectedLanguage}
          onPress={sourcePillOnPress}
        />
      </Animated.View>,
      <SwapButton
        key="swap-button"
        sourceLang={sourceLang}
        targetLang={targetLang}
        onSwap={onSwap}
        swapRotation={swapRotation}
      />,
      <Animated.View
        key="target-pill"
        layout={LinearTransition.springify()}
        style={{ flex: 1 }}
      >
        <LanguagePill langCode={targetLang} onPress={targetPillOnPress} />
      </Animated.View>,
    ],
    [
      sourceLang,
      targetLang,
      detectedLanguage,
      onSwap,
      swapRotation,
      sourcePillOnPress,
      targetPillOnPress,
    ],
  );

  return (
    <Animated.View
      layout={LinearTransition.springify()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderRadius: borderRadius["2xl"],
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
        options={activeDropdown === "source" ? sourceOptions : myLanguages}
        currentLang={activeDropdown === "source" ? sourceLang : targetLang}
        onSelect={handleSelect}
        animatedStyle={animatedDropdownStyle}
        gatedOptions={gatedOptions}
        onPressGated={handlePressGated}
      />

      {items}
    </Animated.View>
  );
}
