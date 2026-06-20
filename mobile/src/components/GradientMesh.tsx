import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";

import { Box } from "@/components/ui";
import { useTheme } from "@/hooks";

export const GradientMesh = (): React.JSX.Element => {
  const { color, isDark } = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const isAnimating = useRef(true);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotionEnabled);
    if (reduceMotionEnabled) return;

    const startAnimations = (): void => {
      if (!isAnimating.current) return;
      x.value = withRepeat(
        withSequence(
          withTiming(100, { duration: 5000 }),
          withTiming(0, { duration: 5000 }),
        ),
        -1,
      );
      y.value = withRepeat(
        withSequence(
          withTiming(100, { duration: 7000 }),
          withTiming(0, { duration: 7000 }),
        ),
        -1,
      );
    };

    const stopAnimations = (): void => {
      cancelAnimation(x);
      cancelAnimation(y);
    };

    startAnimations();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        isAnimating.current = true;
        startAnimations();
      } else {
        isAnimating.current = false;
        stopAnimations();
      }
    });

    return (): void => {
      stopAnimations();
      sub.remove();
    };
  }, [reduceMotionEnabled, x, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <Box
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      pointerEvents="none"
    >
      <Svg
        height="100%"
        width="100%"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <Defs>
          <RadialGradient id="grad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop
              offset="0%"
              stopColor={isDark ? `${color.foreground}20` : `${color.foreground}10`}
            />
            <Stop offset="100%" stopColor="transparent" />
          </RadialGradient>
        </Defs>
        <Animated.View
          style={[
            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
            animatedStyle,
          ]}
        >
          <Rect width="100%" height="100%" fill="url(#grad)" />
        </Animated.View>
      </Svg>
    </Box>
  );
};
