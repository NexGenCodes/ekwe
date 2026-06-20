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
import { AppToast, triggerHaptic } from "@/utils";

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
    targetLang === "" ||
    sourceLang === targetLang;

  const animatedSwapStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${swapRotation.value}deg` }],
    };
  });

  const handlePress = async (): Promise<void> => {
    if (isSwapDisabled) {
      triggerHaptic(Haptics.NotificationFeedbackType.Warning);
      const message =
        sourceLang === "auto" || targetLang === "auto"
          ? "Cannot swap when source is set to Auto Detect"
          : "Source and target languages must be different";
      AppToast.info(message);
      return;
    }
    swapRotation.value = withTiming(swapRotation.value + 180, {
      duration: duration.normal,
    });
    await triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
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
          backgroundColor: color.brand,
        },
        (pressed || isSwapDisabled) && { opacity: opacity.disabled },
        pressed && !isSwapDisabled && { transform: [{ scale: 0.9 }] },
      ]}
    >
      <Animated.View style={animatedSwapStyle}>
        <ArrowRightLeft size={16} color={color.onBrand} strokeWidth={2.5} />
      </Animated.View>
    </Pressable>
  );
}
