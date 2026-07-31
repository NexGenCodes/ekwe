import React, { useEffect } from "react";
import { StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from "react-native-reanimated";

import { useTheme } from "@/hooks";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export const BackgroundFlair = (): React.ReactElement => {
  const { color } = useTheme();

  const blob1X = useSharedValue(0);
  const blob1Y = useSharedValue(0);

  useEffect(() => {
    blob1X.value = withRepeat(
      withSequence(
        withTiming(30, { duration: 32000 }),
        withTiming(-30, { duration: 38000 }),
        withTiming(0, { duration: 28000 }),
      ),
      -1,
      true,
    );

    blob1Y.value = withRepeat(
      withSequence(
        withTiming(-40, { duration: 30000 }),
        withTiming(40, { duration: 36000 }),
        withTiming(0, { duration: 26000 }),
      ),
      -1,
      true,
    );
  }, [blob1X, blob1Y]);

  const animatedBlob1Style = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: blob1X.value }, { translateY: blob1Y.value }],
    };
  });

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Top-Right Ambient Blob (Subtle Brand Blue) */}
      <Animated.View
        style={[
          styles.blob,
          {
            width: SCREEN_WIDTH * 0.85,
            height: SCREEN_WIDTH * 0.85,
            borderRadius: (SCREEN_WIDTH * 0.85) / 2,
            backgroundColor: color.brand,
            opacity: 0.15,
            top: -SCREEN_HEIGHT * 0.08,
            right: -SCREEN_WIDTH * 0.25,
          },
          animatedBlob1Style,
        ]}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  blob: {
    position: "absolute",
  },
});
