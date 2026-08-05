import Monitor from "lucide-react-native/icons/monitor";
import Moon from "lucide-react-native/icons/moon";
import Sun from "lucide-react-native/icons/sun";
import React, { useEffect, useState } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemePickerModal } from "./ThemePickerModal";

import { Box, Pressable } from "@/components/ui";
import { spring } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { useTheme } from "@/hooks";
import { triggerHaptic } from "@/utils/haptics";

export interface ThemeTogglerProps {
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const ThemeToggler = ({
  style,
  accessibilityLabel,
}: ThemeTogglerProps): React.ReactElement => {
  const { colorScheme, color, setColorScheme } = useTheme();
  const [isModalVisible, setIsModalVisible] = useState(false);

  const transition = useSharedValue(
    colorScheme === "system" ? 0 : colorScheme === "light" ? 1 : 2,
  );

  useEffect(() => {
    transition.value = withSpring(
      colorScheme === "system" ? 0 : colorScheme === "light" ? 1 : 2,
      spring.smooth,
    );
  }, [colorScheme, transition]);

  const handlePress = (): void => {
    setIsModalVisible(true);
    triggerHaptic();
  };

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${transition.value * 120}deg` }],
  }));

  const sunStyle = useAnimatedStyle(() => ({
    opacity: withSpring(colorScheme === "light" ? 1 : 0, spring.smooth),
    transform: [
      { scale: withSpring(colorScheme === "light" ? 1 : 0.5, spring.smooth) },
    ],
    position: "absolute",
  }));

  const moonStyle = useAnimatedStyle(() => ({
    opacity: withSpring(colorScheme === "dark" ? 1 : 0, spring.smooth),
    transform: [
      { scale: withSpring(colorScheme === "dark" ? 1 : 0.5, spring.smooth) },
    ],
    position: "absolute",
  }));

  const systemStyle = useAnimatedStyle(() => ({
    opacity: withSpring(colorScheme === "system" ? 1 : 0, spring.smooth),
    transform: [
      { scale: withSpring(colorScheme === "system" ? 1 : 0.5, spring.smooth) },
    ],
    position: "absolute",
  }));

  return (
    <Box>
      <Pressable
        onPress={handlePress}
        style={[
          style,
          {
            width: 48,
            height: 48,
            borderRadius: borderRadius["2xl"],
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: color.border,
            backgroundColor:
              colorScheme === "dark" ? color.surface : color.background,
          },
        ]}
        accessibilityLabel={
          accessibilityLabel ||
          `Open appearance selector. Current mode: ${colorScheme}`
        }
      >
        <Animated.View
          style={[
            iconStyle,
            { alignItems: "center", justifyContent: "center" },
          ]}
        >
          <Animated.View style={sunStyle}>
            <Sun size={24} color={color.foreground} strokeWidth={2.5} />
          </Animated.View>
          <Animated.View style={moonStyle}>
            <Moon size={24} color={color.foreground} strokeWidth={2.5} />
          </Animated.View>
          <Animated.View style={systemStyle}>
            <Monitor size={24} color={color.foreground} strokeWidth={2.5} />
          </Animated.View>
        </Animated.View>
      </Pressable>

      <ThemePickerModal
        visible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        onSelect={async (value) => {
          await triggerHaptic();
          setColorScheme(value);
          setIsModalVisible(false);
        }}
        currentTheme={colorScheme}
      />
    </Box>
  );
};
