import Check from "lucide-react-native/icons/check";
import Sun from "lucide-react-native/icons/sun";
import Moon from "lucide-react-native/icons/moon";
import Monitor from "lucide-react-native/icons/monitor";
import React from "react";
import { ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";
import { triggerHaptic } from "@/utils/haptics";

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
    <Sheet visible={visible} onClose={onClose} title="Select Appearance">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          paddingBottom: spacing["2xl"],
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
                  backgroundColor: withAlpha(color.brand, 0.08),
                },
              ]}
              onPress={() => {
                triggerHaptic();
                onSelect(item.value);
              }}
              accessibilityLabel={`Select ${item.label}`}
              accessibilityState={isSelected ? { selected: true } : undefined}
            >
              <Box style={{ marginRight: spacing.md }}>
                <item.icon
                  size={20}
                  color={isSelected ? color.brand : color.foreground}
                  strokeWidth={2}
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text
                  variant="body"
                  style={{
                    color: color.foreground,
                    fontWeight: isSelected ? "600" : "400",
                  }}
                >
                  {item.label}
                </Text>
              </Box>
              {isSelected && <Check size={20} color={color.brand} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}
