import * as Haptics from "expo-haptics";
import { ArrowRightLeft } from "lucide-react-native";
import React from "react";
import Animated, {
  useAnimatedStyle,
  withTiming,
  SharedValue,
} from "react-native-reanimated";

import { Pressable } from "@/components/ui";
import { duration, shadows } from "@/constants";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { AppToast } from "@/utils";

interface SwapButtonProps {
  sourceLang: string;
  targetLang: string;
  onSwap: () => void;
  swapRotation: SharedValue<number>;
}

export function SwapButton({
  sourceLang,
  targetLang,
  onSwap,
  swapRotation,
}: SwapButtonProps): React.ReactElement {
  const { color } = useTheme();

  const isSwapDisabled =
    sourceLang === "auto" ||
    targetLang === "auto" ||
    sourceLang === "" ||
    targetLang === "";

  const animatedSwapStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${swapRotation.value}deg` }],
    };
  });

  const handlePress = async (): Promise<void> => {
    if (isSwapDisabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      AppToast.info("Auto detect is only available for source language");
      return;
    }
    swapRotation.value = withTiming(swapRotation.value + 180, {
      duration: duration.normal,
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSwap();
  };

  return (
    <Pressable
      accessibilityLabel="Swap languages"
      onPress={handlePress}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: borderRadius["2xl"],
          alignItems: "center",
          justifyContent: "center",
          marginHorizontal: spacing.xs,
          ...shadows.soft,
          backgroundColor: color.secondary,
        },
        (pressed || isSwapDisabled) && { opacity: opacity.disabled },
        pressed && !isSwapDisabled && { transform: [{ scale: 0.9 }] },
      ]}
    >
      <Animated.View style={animatedSwapStyle}>
        <ArrowRightLeft size={16} color={color.onSecondary} strokeWidth={2.5} />
      </Animated.View>
    </Pressable>
  );
}
