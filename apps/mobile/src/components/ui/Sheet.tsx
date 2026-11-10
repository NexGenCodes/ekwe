import X from "lucide-react-native/icons/x";
import React from "react";
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  type DimensionValue,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/Box";
import { Pressable } from "@/components/ui/Pressable";
import { Text } from "@/components/ui/Text";

import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useReduceMotion } from "@/hooks";

const DRAG_CLOSE_THRESHOLD = 96;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: DimensionValue;

  height?: DimensionValue;
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
  maxHeight = "60%",
  height,
}: SheetProps): React.JSX.Element {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const translateY = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-8, 8])
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > DRAG_CLOSE_THRESHOLD) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  return (
    <RNModal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Box
            style={{
              flex: 1,
              justifyContent: "flex-end",
              backgroundColor: color.overlay,
            }}
          >
            <Pressable style={{ flex: 1 }} onPress={onClose} feedback="none" />

            <Animated.View style={animatedStyle}>
              <Box
                style={{
                  borderTopLeftRadius: borderRadius["2xl"],
                  borderTopRightRadius: borderRadius["2xl"],
                  height,
                  maxHeight: height ?? maxHeight,
                  backgroundColor: color.background,
                  paddingBottom: insets.bottom,
                }}
              >
                <GestureDetector gesture={pan}>
                  <Box
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel="Drag down to close"
                    style={{
                      alignItems: "center",
                      paddingVertical: spacing.md,
                      paddingTop: spacing.md,
                    }}
                  >
                    <Box
                      style={{
                        width: 40,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: color.handle,
                      }}
                    />
                  </Box>
                </GestureDetector>
                {title && (
                  <Box
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: spacing.lg,
                      paddingTop: 0,
                      borderBottomWidth: 1,
                      borderColor: color.border,
                    }}
                  >
                    <Text
                      variant="heading3"
                      style={{ color: color.foreground }}
                    >
                      {title}
                    </Text>
                    <Pressable
                      onPress={onClose}
                      hitSlop={10}
                      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                      accessibilityLabel="Close"
                    >
                      <X size={24} color={color.muted} />
                    </Pressable>
                  </Box>
                )}

                {children}
              </Box>
            </Animated.View>
          </Box>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </RNModal>
  );
}
