import Check from "lucide-react-native/icons/check";
import Globe from "lucide-react-native/icons/globe";
import React from "react";
import { ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { getCurrencySymbol } from "@ekwe/shared/money";
import { CURRENCY_NAMES, MANUAL_CURRENCY_OPTIONS } from "@/constants/currency";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";
import { triggerHaptic } from "@/utils/haptics";

interface CurrencyPickerModalProps {
  visible: boolean;
  onClose: () => void;

  onSelect: (value: string | null) => void;

  currentCurrency: string | null;

  resolvedCurrency?: string;
}

const AUTO_LABEL = "Auto (detected)";

export function CurrencyPickerModal({
  visible,
  onClose,
  onSelect,
  currentCurrency,
  resolvedCurrency,
}: CurrencyPickerModalProps): React.JSX.Element {
  const { color } = useTheme();

  const autoLabel = resolvedCurrency
    ? `${getCurrencySymbol(resolvedCurrency)} ${
        CURRENCY_NAMES[resolvedCurrency] ?? resolvedCurrency
      } (auto)`
    : AUTO_LABEL;

  const options = [
    { value: null as string | null, label: autoLabel },
    ...MANUAL_CURRENCY_OPTIONS.map((code) => ({
      value: code,
      label: CURRENCY_NAMES[code] ?? code,
    })),
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title="Select Currency">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          paddingBottom: spacing["2xl"],
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
                  <Globe size={20} color={color.foreground} strokeWidth={2} />
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
                    {getCurrencySymbol(item.value)} {item.value}
                  </Text>
                ) : resolvedCurrency ? (
                  <Text
                    variant="caption"
                    style={{
                      color: color.muted,
                      marginTop: spacing.hairline,
                    }}
                  >
                    {getCurrencySymbol(resolvedCurrency)} {resolvedCurrency} ·
                    based on your region
                  </Text>
                ) : null}
              </Box>
              {isSelected && <Check size={20} color={color.brand} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}
