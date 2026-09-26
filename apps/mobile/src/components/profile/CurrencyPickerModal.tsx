import Check from "lucide-react-native/icons/check";
import React from "react";
import { ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import {
  getCurrencySymbol,
  type FlutterwaveCurrency,
} from "@ekwe/shared/money";
import { CURRENCY_NAMES, MANUAL_CURRENCY_OPTIONS } from "@/constants/currency";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";
import { triggerHaptic } from "@/utils/haptics";

interface CurrencyPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (value: FlutterwaveCurrency) => void;
  currentCurrency: FlutterwaveCurrency;
}

export function CurrencyPickerModal({
  visible,
  onClose,
  onSelect,
  currentCurrency,
}: CurrencyPickerModalProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose} title="Payment currency">
      <Box style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Text variant="caption" style={{ color: color.muted }}>
          NGN is the default. Choose another currency anytime before checkout.
        </Text>
      </Box>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          paddingBottom: spacing["2xl"],
        }}
      >
        {MANUAL_CURRENCY_OPTIONS.map((code) => {
          const isSelected = currentCurrency === code;
          return (
            <Pressable
              key={code}
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
                onSelect(code);
              }}
              accessibilityLabel={`Select ${CURRENCY_NAMES[code] ?? code}`}
              accessibilityState={isSelected ? { selected: true } : undefined}
            >
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
                  {getCurrencySymbol(code)}
                </Text>
              </Box>
              <Box style={{ flex: 1 }}>
                <Text
                  variant="body"
                  style={{
                    color: color.foreground,
                    fontWeight: isSelected ? "600" : "400",
                  }}
                >
                  {CURRENCY_NAMES[code] ?? code}
                </Text>
                <Text
                  variant="caption"
                  style={{ color: color.muted, marginTop: spacing.hairline }}
                >
                  {code}
                  {code === "NGN" ? " · Default" : ""}
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
