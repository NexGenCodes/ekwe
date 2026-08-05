import X from "lucide-react-native/icons/x";
import React from "react";
import { Modal as RNModal, type DimensionValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "./Box";
import { Pressable } from "./Pressable";
import { Text } from "./Text";

import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: DimensionValue;
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
  maxHeight = "60%",
}: SheetProps): React.JSX.Element {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
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
            maxHeight,
            borderTopWidth: 1,
            backgroundColor: color.background,
            borderColor: color.border,
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
    </RNModal>
  );
}
