import Check from "lucide-react-native/icons/check";
import Lock from "lucide-react-native/icons/lock";
import type { JSX } from "react";

import { LanguageFlag } from "./LanguageFlag";

import { Box, Pressable, Text } from "@/components/ui";
import { getLanguageName } from "@/constants/languages";
import { useTokens } from "@/hooks/ui";

export interface LanguageRowProps {
  code: string;
  isSelected: boolean;
  showLock?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export function LanguageRow({
  code,
  isSelected,
  showLock = false,
  disabled = false,
  onPress,
}: LanguageRowProps): JSX.Element {
  const { color, spacing, borderRadius } = useTokens();
  const langName = getLanguageName(code);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        backgroundColor: color.background,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Box style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        <Box style={{ marginRight: spacing.md }}>
          <LanguageFlag code={code} size="sm" />
        </Box>
        <Text
          variant="body"
          style={{ color: disabled ? color.muted : color.foreground }}
        >
          {langName}
          {disabled ? "  ✕" : ""}
        </Text>
      </Box>

      <Box style={{ flexDirection: "row", alignItems: "center" }}>
        {showLock && (
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              borderRadius: borderRadius.md,
              backgroundColor: color.surface,
              marginRight: spacing.sm,
            }}
          >
            <Lock size={10} color={color.brand} strokeWidth={2.5} />
            <Text variant="caption" style={{ color: color.brand }}>
              Pro
            </Text>
          </Box>
        )}

        <Box
          style={[
            {
              width: 22,
              height: 22,
              borderRadius: borderRadius.lg,
              marginLeft: spacing.md,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
            },
            isSelected
              ? { backgroundColor: color.brand, borderWidth: 0 }
              : { backgroundColor: "transparent", borderColor: color.border },
          ]}
        >
          {isSelected && (
            <Check size={12} color={color.onBrand} strokeWidth={3} />
          )}
        </Box>
      </Box>
    </Pressable>
  );
}
