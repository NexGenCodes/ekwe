import React, { useEffect, useState } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Box, Pressable, Text } from "@/components/ui";
import { duration, shadows } from "@/constants";
import { borderRadius, touchTarget } from "@/constants/sizes";
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
  const [containerWidth, setContainerWidth] = useState(0);

  const indent = spacing.xs;
  const optionWidth = Math.max(0, (containerWidth - indent * 2) / 2);
  const slideAnim = useSharedValue(isAnnual ? 1 : 0);

  useEffect(() => {
    slideAnim.value = withTiming(isAnnual ? 1 : 0, {
      duration: duration.normal,
    });
  }, [isAnnual, slideAnim]);

  const indicatorStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: slideAnim.value * optionWidth }],
    }),
    [optionWidth],
  );

  return (
    <Box
      style={[styles.toggleContainer, { backgroundColor: color.surface }]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
      accessibilityLabel="Billing period"
    >
      <Animated.View
        style={[
          styles.toggleIndicator,
          {
            backgroundColor: color.brand,
            left: indent,
            bottom: indent,
            width: optionWidth,
          },
          indicatorStyle,
        ]}
      />
      <Pressable
        onPress={() => onToggle(false)}
        style={styles.toggleOption}
        hitSlop={10}
        accessibilityRole="tab"
        accessibilityState={{ selected: !isAnnual }}
        accessibilityLabel="Monthly billing"
      >
        <Text
          variant={!isAnnual ? "label" : "body"}
          style={{ color: !isAnnual ? color.onBrand : color.foreground }}
        >
          Monthly
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onToggle(true)}
        style={styles.toggleOption}
        hitSlop={10}
        accessibilityRole="tab"
        accessibilityState={{ selected: isAnnual }}
        accessibilityLabel="Annual billing"
      >
        <Text
          variant={isAnnual ? "label" : "body"}
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
    alignSelf: "stretch",
    position: "relative",
  } as const,
  toggleIndicator: {
    position: "absolute",
    top: spacing.xs,
    borderRadius: borderRadius.full,
    boxShadow: shadows.soft,
  } as const,
  toggleOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget.comfortable,
    zIndex: 1,
  } as const,
};
