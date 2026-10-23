import React, { forwardRef, useState } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  createAnimatedComponent,
} from "react-native-reanimated";

import { Box } from "@/components/ui";
import { PaidBadge } from "@/components/PaidBadge";
import { useLockedFeature } from "@/hooks/useLockedFeature";
import { spacing } from "@/constants/spacing";
import { opacity } from "@/constants/sizes";

const AnimatedPressable = createAnimatedComponent(Pressable);

interface LockedPressableProps extends PressableProps {
  locked?: boolean;

  label?: string;

  children: React.ReactNode;

  navigateToBilling?: boolean;

  message?: string;

  contentStyle?: ViewStyle;
}

export const LockedPressable = forwardRef<
  React.ComponentRef<typeof Pressable>,
  LockedPressableProps
>(
  (
    {
      locked = false,
      label,
      children,
      navigateToBilling = false,
      message,
      contentStyle,
      onPress,
      onPressIn,
      onPressOut,
      style,
      hitSlop = 8,
      accessibilityLabel,
      accessibilityHint,
      accessibilityRole,
      accessibilityState,
      accessible,
      ...props
    },
    ref,
  ) => {
    const handleLockedPress = useLockedFeature({
      navigateToBilling,
      message,
    });
    const [pressed, setPressed] = useState(false);
    const pressScale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: pressScale.value }],
    }));

    const handlePressIn = (event: GestureResponderEvent): void => {
      setPressed(true);
      if (locked) return;
      pressScale.value = withTiming(0.97, { duration: 80 });
      onPressIn?.(event);
    };

    const handlePressOut = (event: GestureResponderEvent): void => {
      setPressed(false);
      if (locked) return;
      pressScale.value = withTiming(1, { duration: 120 });
      onPressOut?.(event);
    };

    const handlePress = (event: GestureResponderEvent): void => {
      if (locked) {
        handleLockedPress();
        return;
      }
      onPress?.(event);
    };

    const resolvedStyle: StyleProp<ViewStyle> =
      typeof style === "function" ? style({ pressed }) : style;

    return (
      <AnimatedPressable
        {...props}
        ref={ref}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        hitSlop={hitSlop}
        style={[
          {
            opacity: locked ? opacity.inactive : 1,
          },
          resolvedStyle,
          animatedStyle,
        ]}
        accessible={accessible}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={
          locked ? "Requires the Ekwe Paid plan" : accessibilityHint
        }
        accessibilityState={{
          disabled: locked,
          ...(accessibilityState?.selected !== undefined
            ? { selected: accessibilityState.selected }
            : {}),
          ...(accessibilityState?.checked !== undefined
            ? { checked: accessibilityState.checked }
            : {}),
        }}
      >
        <Box
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            },
            contentStyle,
          ]}
        >
          {children}
          {locked && label && <PaidBadge size="sm" />}
        </Box>
      </AnimatedPressable>
    );
  },
);

LockedPressable.displayName = "LockedPressable";
