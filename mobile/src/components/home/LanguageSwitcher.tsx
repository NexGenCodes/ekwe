import React from "react";
import Animated, {
  useAnimatedStyle,
  LinearTransition,
} from "react-native-reanimated";

import { LanguageDropdown } from "./LanguageDropdown";
import { LanguagePill } from "./LanguagePill";
import { SwapButton } from "./SwapButton";

import { borderRadius, zIndex } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useLanguageSwitcher } from "@/hooks";

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

  const sourceOptions = React.useMemo(
    () => ["auto", ...myLanguages],
    [myLanguages],
  );

  const sourcePillOnPress = React.useCallback(
    () => openDropdown("source"),
    [openDropdown],
  );
  const targetPillOnPress = React.useCallback(
    () => openDropdown("target"),
    [openDropdown],
  );

  const items = React.useMemo(
    () => [
      <Animated.View
        key="source-pill"
        layout={LinearTransition.springify()}
        style={{ flex: 1 }}
      >
        <LanguagePill langCode={sourceLang} onPress={sourcePillOnPress} />
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
        zIndex: zIndex.dropdown,
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
        oppositeLang={activeDropdown === "source" ? targetLang : sourceLang}
        onSelect={handleSelect}
        animatedStyle={animatedDropdownStyle}
      />

      {items}
    </Animated.View>
  );
}
