import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import Globe from "lucide-react-native/icons/globe";
import React from "react";
import { Modal, ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { getCurrencySymbol } from "@ekwe/shared/money";
import { CURRENCY_NAMES, MANUAL_CURRENCY_OPTIONS } from "@/constants/currency";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

interface CurrencyPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Picked ISO 4217 code, or null for Auto (device detection). */
  onSelect: (value: string | null) => void;
  /** Currently selected code, or null for Auto. */
  currentCurrency: string | null;
}

const AUTO_LABEL = "Auto (detected)";

export function CurrencyPickerModal({
  visible,
  onClose,
  onSelect,
  currentCurrency,
}: CurrencyPickerModalProps): React.JSX.Element {
  const { color } = useTheme();

  const options = [
    { value: null as string | null, label: AUTO_LABEL },
    ...MANUAL_CURRENCY_OPTIONS.map((code) => ({
      value: code,
      label: CURRENCY_NAMES[code] ?? code,
    })),
  ];

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
              Select Currency
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityLabel="Close currency picker"
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
            {options.map((item) => {
              const isSelected = currentCurrency === item.value;
              return (
                <Pressable
                  key={item.value ?? "auto"}
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
                  {item.value ? (
                    <Box
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: borderRadius.md,
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: spacing.md,
                        backgroundColor: withAlpha(color.foreground, 0.08),
                      }}
                    >
                      <Text
                        variant="body"
                        style={{ color: color.foreground, fontWeight: "600" }}
                      >
                        {getCurrencySymbol(item.value)}
                      </Text>
                    </Box>
                  ) : (
                    <Box style={{ marginRight: spacing.md }}>
                      <Globe
                        size={20}
                        color={color.foreground}
                        strokeWidth={2}
                      />
                    </Box>
                  )}
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
                    {item.value ? (
                      <Text
                        variant="caption"
                        style={{
                          color: color.muted,
                          marginTop: spacing.hairline,
                        }}
                      >
                        {item.value}
                      </Text>
                    ) : null}
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
