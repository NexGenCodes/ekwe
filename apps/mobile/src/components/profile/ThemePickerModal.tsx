import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import Sun from "lucide-react-native/icons/sun";
import Moon from "lucide-react-native/icons/moon";
import Monitor from "lucide-react-native/icons/monitor";
import React from "react";
import { Modal, ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

interface ThemePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (value: "light" | "dark" | "system") => void;
  currentTheme: "light" | "dark" | "system";
}

const THEME_OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System (Follow Device)", icon: Monitor },
];

export function ThemePickerModal({
  visible,
  onClose,
  onSelect,
  currentTheme,
}: ThemePickerModalProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Modal
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
        <Box
          style={{
            borderTopLeftRadius: borderRadius["2xl"],
            borderTopRightRadius: borderRadius["2xl"],
            maxHeight: "60%",
            borderTopWidth: 1,
            backgroundColor: color.background,
            borderColor: color.border,
          }}
        >
          {/* Header */}
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
            <Text
              variant="heading3"
              style={{
                color: color.foreground,
              }}
            >
              Select Appearance
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityLabel="Close appearance picker"
            >
              <X size={24} color={color.muted} />
            </Pressable>
          </Box>

          {/* List */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
            }}
          >
            {THEME_OPTIONS.map((item) => {
              const isSelected = currentTheme === item.value;
              return (
                <Pressable
                  key={item.value}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: spacing.md,
                      paddingHorizontal: spacing.sm,
                      borderRadius: borderRadius.lg,
                      marginVertical: spacing.hairline,
                    },
pressed && {
                        backgroundColor: withAlpha(color.foreground, 0.102),
                      },
                      isSelected && {
                        backgroundColor: withAlpha(color.foreground, 0.051),
                      },
                  ]}
                  onPress={() => onSelect(item.value)}
                  accessibilityLabel={`Select ${item.label}`}
                  accessibilityState={
                    isSelected ? { selected: true } : undefined
                  }
                >
                  <Box style={{ marginRight: spacing.md }}>
                    <item.icon
                      size={20}
                      color={isSelected ? color.foreground : color.foreground}
                      strokeWidth={2}
                    />
                  </Box>
                  <Box style={{ flex: 1 }}>
                    <Text
                      variant="body"
                      style={{
                        color: isSelected ? color.foreground : color.foreground,
                        fontWeight: isSelected ? "600" : "400",
                      }}
                    >
                      {item.label}
                    </Text>
                  </Box>
                  {isSelected && <Check size={20} color={color.foreground} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Box>
      </Box>
    </Modal>
  );
}
