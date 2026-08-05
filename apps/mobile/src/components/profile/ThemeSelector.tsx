import Monitor from "lucide-react-native/icons/monitor";
import Moon from "lucide-react-native/icons/moon";
import Sun from "lucide-react-native/icons/sun";
import React from "react";
import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { Box, Pressable } from "@/components/ui";
import { spring } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { settingsActions, ThemePreference } from "@/store";
import { triggerHaptic } from "@/utils/haptics";

const SEGMENT_SIZE = 36;
const SEGMENTS: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: ThemePreference.Light, icon: Sun },
  { value: ThemePreference.Dark, icon: Moon },
  { value: ThemePreference.System, icon: Monitor },
];

export function ThemeSelector(): React.ReactElement {
  const { colorScheme, color } = useTheme();

  const activeIndex = SEGMENTS.findIndex((s) => s.value === colorScheme);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: withSpring(activeIndex * SEGMENT_SIZE, spring.smooth),
      },
    ],
  }));

  const handleSelect = (preference: ThemePreference): void => {
    if (colorScheme !== preference) {
      triggerHaptic();
      settingsActions.setThemePreference(preference);
    }
  };

  return (
    <Box
      style={{
        flexDirection: "row",
        backgroundColor: color.surface,
        borderRadius: borderRadius.xl,
        padding: spacing.xs,
        position: "relative",
      }}
    >
      {/* Sliding indicator */}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: spacing.xs,
            left: spacing.xs,
            width: SEGMENT_SIZE,
            height: SEGMENT_SIZE,
            borderRadius: borderRadius.lg,
            backgroundColor: color.foreground,
          },
          indicatorStyle,
        ]}
      />

      {SEGMENTS.map(({ value, icon: Icon }) => {
        const isActive = colorScheme === value;
        return (
          <Pressable
            key={value}
            onPress={() => handleSelect(value)}
            style={{
              width: SEGMENT_SIZE,
              height: SEGMENT_SIZE,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: borderRadius.lg,
            }}
            accessibilityLabel={`Set theme to ${value}`}
          >
            <Icon
              size={16}
              color={isActive ? color.onBrand : color.muted}
              strokeWidth={2.5}
            />
          </Pressable>
        );
      })}
    </Box>
  );
}
