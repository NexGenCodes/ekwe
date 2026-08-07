import X from "lucide-react-native/icons/x";
import React from "react";
import { Modal as RNModal, type DimensionValue } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "./Box";
import { Pressable } from "./Pressable";
import { Text } from "./Text";

import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useReduceMotion } from "@/hooks";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: DimensionValue;
  /**
   * Fixed height for the sheet (e.g. so a loading state can fill the sheet
   * and vertically center its content). When set, takes precedence over the
   * content-sized `maxHeight` behavior.
   */
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

  return (
    <RNModal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Box
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: color.overlay,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} feedback="none" />

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
            {title && (
              <Box
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: spacing.lg,
                  borderBottomWidth: 1,
                  borderColor: color.border,
                }}
              >
                <Text variant="heading3" style={{ color: color.foreground }}>
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
        </Box>
      </GestureHandlerRootView>
    </RNModal>
  );
}
