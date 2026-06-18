import { Search, X } from "lucide-react-native";
import type { JSX } from "react";
import { TextInput } from "react-native";

import { Box, Pressable } from "@/components/ui";
import { useTokens } from "@/hooks/ui";

export interface LanguageSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function LanguageSearchBar({
  value,
  onChangeText,
  placeholder = "Search languages",
}: LanguageSearchBarProps): JSX.Element {
  const { color, spacing, borderRadius, typography } = useTokens();

  return (
    <Box
      style={{
        height: 44,
        borderWidth: 0.5,
        borderRadius: borderRadius.lg,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        backgroundColor: color.card,
        borderColor: color.border,
      }}
    >
      <Search
        size={18}
        color={color.muted}
        style={{ marginRight: spacing.sm }}
      />
      <TextInput
        style={{
          flex: 1,
          height: 44,
          ...typography.body,
          color: color.foreground,
        }}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText("")} hitSlop={8}>
          <X size={16} color={color.muted} />
        </Pressable>
      )}
    </Box>
  );
}
