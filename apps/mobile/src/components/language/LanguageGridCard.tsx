import Check from "lucide-react-native/icons/check";
import Globe from "lucide-react-native/icons/globe";
import type { JSX } from "react";
import type { DimensionValue } from "react-native";

import { LanguageFlag } from "./LanguageFlag";

import { Box, Pressable, Text } from "@/components/ui";
import { useTokens } from "@/hooks/ui";
import { withAlpha } from "@/utils";
import { triggerHaptic } from "@/utils/haptics";

export interface LanguageGridCardProps {
  code: string;
  label: string;
  isSelected: boolean;
  disabled?: boolean;
  dashed?: boolean;
  onPress: () => void;
  width?: DimensionValue;
  aspectRatio?: number;
}

export function LanguageGridCard({
  code,
  label,
  isSelected,
  disabled = false,
  dashed = false,
  onPress,
  width,
  aspectRatio = 1,
}: LanguageGridCardProps): JSX.Element {
  const { color, spacing, borderRadius, opacity } = useTokens();
  const isLandscape = aspectRatio > 1.5;

  return (
    <Pressable
      feedback="scale"
      disabled={disabled}
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      accessibilityLabel={`${label}${isSelected ? ", selected" : ""}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      style={{
        width: width ?? "100%",
        aspectRatio,
        borderRadius: borderRadius["2xl"],
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        flexDirection: isLandscape ? "row" : "column",
        borderStyle: dashed ? "dashed" : "solid",
        backgroundColor: isSelected ? withAlpha(color.brand, 0.12) : color.card,
        borderColor: isSelected ? color.brand : color.border,
        opacity: disabled ? opacity.disabled : 1,
      }}
    >
      {code === "auto" ? (
        <Globe size={20} color={color.brand} />
      ) : (
        <LanguageFlag code={code} size="md" />
      )}
      <Text
        variant="bodySmall"
        style={{
          textAlign: "center",
          flex: isLandscape ? 1 : undefined,
          color: isSelected ? color.brand : color.foreground,
          marginLeft: isLandscape ? spacing.sm : 0,
          marginTop: isLandscape ? 0 : spacing.xs,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {isSelected && (
        <Box
          style={{
            marginLeft: isLandscape ? spacing.xs : 0,
            position: isLandscape ? undefined : "absolute",
            top: isLandscape ? undefined : spacing.sm,
            right: isLandscape ? undefined : spacing.sm,
          }}
        >
          <Check
            size={isLandscape ? 18 : 16}
            color={color.brand}
            strokeWidth={3}
          />
        </Box>
      )}
    </Pressable>
  );
}
