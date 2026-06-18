import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Pressable, Text } from "@/components/ui";
import { duration, spring } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface TabBarIconProps {
  color: string;
  size: number;
  focused: boolean;
}

interface TabBarItemOptions {
  tabBarIcon?: (props: TabBarIconProps) => React.ReactNode;
  tabBarAccessibilityLabel?: string;
  tabBarTestID?: string;
}

interface CustomTabBarItemProps {
  isFocused: boolean;
  options: TabBarItemOptions;
  onPress: () => void;
  onLongPress: () => void;
  label: string;
}

export function CustomTabBarItem({
  isFocused,
  options,
  onPress,
  onLongPress,
  label,
}: CustomTabBarItemProps): React.ReactElement {
  const { color } = useTheme();

  // Single source of truth: 0 = inactive, 1 = active
  const progress = useSharedValue(isFocused ? 1 : 0);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    progress.value = withSpring(isFocused ? 1 : 0, spring.snappy);
  }, [isFocused, progress]);

  const handlePressIn = (): void => {
    pressScale.value = withTiming(0.93, { duration: duration.fast });
  };

  const handlePressOut = (): void => {
    pressScale.value = withSpring(1, spring.snappy);
  };

  // Outer container: flex expands to reveal label space
  const containerStyle = useAnimatedStyle(() => ({
    flex: interpolate(progress.value, [0, 1], [1, 1.6]),
    transform: [{ scale: pressScale.value }],
  }));

  // Pill background fades in using primary color at low opacity
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["transparent", `${color.secondary}22`],
    ),
    paddingHorizontal: interpolate(progress.value, [0, 1], [12, 18]),
  }));

  // Icon gently scales up when active
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.1]) }],
  }));

  // Label slides in from left with a fade — delayed via 0.5 midpoint
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0, 1]),
    maxWidth: interpolate(progress.value, [0, 1], [0, 100]),
    marginLeft: interpolate(progress.value, [0, 1], [0, 8]),
  }));

  const Icon = options.tabBarIcon;
  const iconColor = isFocused ? color.secondary : color.muted;

  return (
    <Animated.View
      style={[
        {
          alignItems: "center",
          justifyContent: "center",
          marginHorizontal: spacing.xs,
        },
        containerStyle,
      ]}
    >
      <Pressable
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        testID={options.tabBarTestID}
        onPress={() => {
          if (!isFocused) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          onPress();
        }}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        feedback="none"
        style={{
          flex: 1,
          width: "100%",
          minHeight: 48,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Animated.View
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: spacing.md,
              borderRadius: borderRadius.full,
            },
            pillStyle,
          ]}
        >
          <Animated.View style={iconStyle}>
            {Icon ? (
              <Icon size={22} color={iconColor} focused={isFocused} />
            ) : null}
          </Animated.View>

          <Animated.View style={[{ overflow: "hidden" }, labelStyle]}>
            <Text
              variant="label"
              style={{
                color: color.secondary,
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
