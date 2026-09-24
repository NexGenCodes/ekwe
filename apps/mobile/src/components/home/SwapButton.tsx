import * as Haptics from "expo-haptics";
import ArrowRightLeft from "lucide-react-native/icons/arrow-right-left";
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
      await triggerHaptic(Haptics.NotificationFeedbackType.Warning);
      if (sourceLang === "auto" || targetLang === "auto") {
        AppToast.info("Cannot swap when source is set to Auto Detect");
      } else if (sourceLang === targetLang) {
        AppToast.info("Input and output are already the same language");
      }
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
      accessibilityState={{ disabled: isSwapDisabled }}
      onPress={handlePress}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: borderRadius["2xl"],
          alignItems: "center",
          justifyContent: "center",
          marginHorizontal: spacing.xs,
          boxShadow: shadows.soft,
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
