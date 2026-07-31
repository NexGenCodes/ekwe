import { useSelector } from "@legendapp/state/react";
import { BlurView } from "expo-blur";
import { AlertCircle, CheckCircle, Info, Trash2 } from "lucide-react-native";
import React from "react";
import { Modal, useWindowDimensions } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";

import { Box, Pressable, Text } from "@/components/ui";
import { shadows, duration } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { appAlert$, appAlertActions } from "@/store";

const ICON_MAP = {
  info: Info,
  success: CheckCircle,
  error: AlertCircle,
  confirm: Trash2, // Or a warning icon depending on context
};

export function AppAlertModal(): React.JSX.Element | null {
  const { color, isDark } = useTheme();
  const { width } = useWindowDimensions();

  // Subscribe to the global alert state
  const state = useSelector(() => appAlert$.get());
  const { isVisible, type, title, message, buttons, cancelable } = state;

  // Render the correct icon based on type
  const IconComponent = ICON_MAP[type] || Info;
  const iconColor =
    type === "error" || type === "confirm"
      ? color.error
      : type === "success"
        ? color.brand
        : color.brand;

  const handleClose = (): void => {
    if (cancelable) {
      appAlertActions.hide();
    }
  };

  const handleButtonPress = (onPress?: () => void): void => {
    appAlertActions.hide();
    if (onPress) {
      // Small delay to let the modal close animation start
      setTimeout(onPress, 100);
    }
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: color.overlay,
        }}
        entering={FadeIn.duration(duration.normal)}
        exiting={FadeOut.duration(duration.normal)}
      >
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={handleClose}
          accessible={false}
          feedback="none"
        />
        <BlurView
          intensity={isDark ? 20 : 10}
          tint={isDark ? "dark" : "light"}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <Animated.View
          entering={ZoomIn.duration(duration.normal)}
          exiting={ZoomOut.duration(duration.normal)}
          style={[
            {
              borderRadius: borderRadius["2xl"],
              padding: spacing.lg,
              borderWidth: 1,
              boxShadow: shadows.softLg,
            },
            {
              backgroundColor: color.surface,
              borderColor: color.border,
              width: Math.min(width - spacing.xl * 2, 400),
            },
          ]}
        >
          <Box style={{ alignItems: "center", marginBottom: spacing.lg }}>
            <Box
              style={[
                {
                  width: 56,
                  height: 56,
                  borderRadius: borderRadius["2xl"],
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: spacing.md,
                },
                { backgroundColor: isDark ? color.border : color.background },
              ]}
            >
              <IconComponent size={28} color={iconColor} strokeWidth={2.5} />
            </Box>
            <Text
              variant="heading3"
              style={{ textAlign: "center", marginBottom: spacing.sm }}
            >
              {title}
            </Text>
            {message && (
              <Text
                variant="body"
                style={{ textAlign: "center", color: color.muted }}
              >
                {message}
              </Text>
            )}
          </Box>

          <Box
            style={[
              { flexDirection: "column", gap: spacing.md },
              buttons?.length === 2 && { flexDirection: "row" },
            ]}
          >
            {buttons?.map((btn, idx) => {
              const isDestructive = btn.style === "destructive";
              const isCancel = btn.style === "cancel";
              const isPrimary = !isDestructive && !isCancel;

              return (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    {
                      height: 48,
                      borderRadius: borderRadius.xl,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: spacing.md,
                    },
                    isPrimary && { backgroundColor: color.brand },
                    isDestructive && { backgroundColor: color.error },
                    isCancel && {
                      backgroundColor: "transparent",
                      borderWidth: 1,
                      borderColor: color.border,
                    },
                    pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                    buttons.length === 2 && { flex: 1 },
                  ]}
                  onPress={() => handleButtonPress(btn.onPress)}
                  feedback="none"
                >
                  <Text
                    variant="body"
                    style={[
                      isPrimary && { color: color.onBrand },
                      isDestructive && { color: color.onBrand },
                      isCancel && { color: color.foreground },
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </Box>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
