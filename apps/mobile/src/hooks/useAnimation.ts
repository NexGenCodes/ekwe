import { useEffect } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
} from "react-native-reanimated";

interface StaggerConfig {
  baseDelay?: number;
  stepDelay?: number;
  duration?: number;
  damping?: number;
  stiffness?: number;
}

interface FadeConfig {
  duration?: number;
  delay?: number;
}

interface SlideConfig extends FadeConfig {
  direction?: "up" | "down" | "left" | "right";
  distance?: number;
}

/**
 * Staggered entrance animation for lists (fade + slide up + scale).
 */
export function useStaggerEntrance(
  index: number,
  config: StaggerConfig = {},
): ReturnType<typeof useAnimatedStyle> {
  const {
    baseDelay = 600,
    stepDelay = 180,
    duration = 700,
    damping = 15,
    stiffness = 90,
  } = config;

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(30);
  const scale = useSharedValue(0.95);

  useEffect(() => {
    const delay = baseDelay + index * stepDelay;

    opacity.value = withDelay(delay, withTiming(1, { duration }));
    translateY.value = withDelay(
      delay,
      withSpring(0, { damping, stiffness, mass: 0.8 }),
    );
    scale.value = withDelay(
      delay,
      withSpring(1, { damping, stiffness: stiffness + 10 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
}

/**
 * Header/section entrance animation (fade in + scale up).
 */
export function useHeaderEntrance(): ReturnType<typeof useAnimatedStyle> {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const translateY = useSharedValue(-20);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 1000 });
    scale.value = withSpring(1, { damping: 15, stiffness: 60 });
    translateY.value = withSpring(0, { damping: 15, stiffness: 60 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
}

/**
 * Simple fade-in animation.
 */
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

/**
 * Slide-in animation from any direction.
 */
export function useSlideIn(
  config: SlideConfig = {},
): ReturnType<typeof useAnimatedStyle> {
  const { duration = 400, delay = 0, direction = "up", distance = 30 } = config;

  const offsetX = useSharedValue(
    direction === "left" ? distance : direction === "right" ? -distance : 0,
  );
  const offsetY = useSharedValue(
    direction === "up" ? distance : direction === "down" ? -distance : 0,
  );
  const opacity = useSharedValue(0);

  useEffect(() => {
    const start = (): void => {
      offsetX.value = withSpring(0, { damping: 18, stiffness: 100 });
      offsetY.value = withSpring(0, { damping: 18, stiffness: 100 });
      opacity.value = withTiming(1, { duration });
    };

    if (delay > 0) {
      const timer = setTimeout(start, delay);
      return (): void => clearTimeout(timer);
    }
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));
}
