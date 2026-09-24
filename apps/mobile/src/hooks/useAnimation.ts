import { useEffect } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from "react-native-reanimated";

interface FadeConfig {
  duration?: number;
  delay?: number;
}

export function useFadeIn(
  config: FadeConfig = {},
): ReturnType<typeof useAnimatedStyle> {
  const { duration = 400, delay = 0 } = config;

  const opacity = useSharedValue(0);

  useEffect(() => {
    if (delay > 0) {
      opacity.value = withDelay(delay, withTiming(1, { duration }));
    } else {
      opacity.value = withTiming(1, { duration });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
