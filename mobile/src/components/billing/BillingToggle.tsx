import React, { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Box, Pressable, Text } from "@/components/ui";
import { duration, shadows } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import type { ThemeTokens } from "@/hooks/ui/useTheme";

export interface BillingToggleProps {
  isAnnual: boolean;
  onToggle: (annual: boolean) => void;
  color: ThemeTokens["color"];
}

export function BillingToggle({
  isAnnual,
  onToggle,
  color,
}: BillingToggleProps): React.JSX.Element {
  const slideAnim = useSharedValue(isAnnual ? 1 : 0);

  useEffect(() => {
    slideAnim.value = withTiming(isAnnual ? 1 : 0, {
      duration: duration.normal,
    });
  }, [isAnnual, slideAnim]);

  const indicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: slideAnim.value * 150 }], // 150 is half of 300
    };
  });

  return (
    <Box style={[styles.toggleContainer, { backgroundColor: color.surface }]}>
      <Animated.View
        style={[
          styles.toggleIndicator,
          { backgroundColor: color.brand },
          indicatorStyle,
        ]}
      />
      <Pressable
        onPress={() => onToggle(false)}
        style={styles.toggleOption}
        hitSlop={10}
      >
        <Text
          variant="body"
          style={{ color: !isAnnual ? color.onBrand : color.foreground }}
        >
          Monthly
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onToggle(true)}
        style={styles.toggleOption}
        hitSlop={10}
      >
        <Text
          variant="body"
          style={{ color: isAnnual ? color.onBrand : color.foreground }}
        >
          Annual
        </Text>
      </Pressable>
    </Box>
  );
}

const styles = {
  toggleContainer: {
    flexDirection: "row",
    borderRadius: borderRadius.full,
    padding: spacing.xs,
    width: 308,
    position: "relative",
  } as const,
  toggleIndicator: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.xs,
    width: 150,
    height: "100%",
    borderRadius: borderRadius.full,
    ...shadows.soft,
  } as const,
  toggleOption: {
    width: 150,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    zIndex: 1,
  } as const,
};
