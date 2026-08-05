import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Modal, ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { SUPPORTED_CURRENCIES } from "@/constants/currency";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface CurrencyPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (code: string) => void;
  currentCurrency: string;
}

export function CurrencyPickerModal({
  visible,
  onClose,
  onSelect,
  currentCurrency,
}: CurrencyPickerModalProps): React.JSX.Element {
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
              Select Preferred Currency
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
            {SUPPORTED_CURRENCIES.map((item) => {
              const isSelected = currentCurrency === item.code;
              return (
                <Pressable
                  key={item.code}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: spacing.md,
                      paddingHorizontal: spacing.sm,
                      borderRadius: borderRadius.lg,
                      marginVertical: 2,
                    },
                    pressed && {
                      backgroundColor: `${color.foreground}1A`,
                    },
                    isSelected && {
                      backgroundColor: `${color.foreground}0D`,
                    },
                  ]}
                  onPress={() => onSelect(item.code)}
                  accessibilityLabel={`Select ${item.name}`}
                  accessibilityState={
                    isSelected ? { selected: true } : undefined
                  }
                >
                  <Text
                    style={{
                      fontSize: 24,
                      marginRight: spacing.md,
                    }}
                  >
                    {item.flag}
                  </Text>
                  <Box style={{ flex: 1 }}>
                    <Text
                      variant="body"
                      style={{
                        color: isSelected ? color.foreground : color.foreground,
                        fontWeight: isSelected ? "600" : "400",
                      }}
                    >
                      {item.code} - {item.name}
                    </Text>
                    <Text
                      variant="caption"
                      style={{
                        color: color.muted,
                        marginTop: 2,
                      }}
                    >
                      {item.region}
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
