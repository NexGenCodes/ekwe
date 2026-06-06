import { ChevronDown } from "lucide-react-native";
import React from "react";
import { StyleProp, ViewStyle } from "react-native";

import { LanguageFlag } from "@/components/language";
import { Text, Pressable } from "@/components/ui";
import { getLanguageAbbreviation } from "@/constants/languages";
import { useTokens } from "@/hooks/ui";

export interface LanguagePillProps {
  langCode: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function LanguagePill({
  langCode,
  onPress,
  style,
}: LanguagePillProps): React.ReactElement {
  const { color, spacing, borderRadius } = useTokens();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      feedback="scale"
      style={[
        {
          flex: 1,
          flexDirection: "row",
          gap: spacing.sm,
          height: 44,
          borderRadius: borderRadius["2xl"],
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: spacing.md,
          backgroundColor: color.card,
          borderColor: color.border,
        },
        style,
      ]}
    >
      <LanguageFlag code={langCode} size="sm" />
      <Text
        variant="bodySmall"
        style={{
          marginRight: spacing.xs,
          color: !langCode ? color.muted : color.foreground,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {!langCode ? "Select" : getLanguageAbbreviation(langCode)}
      </Text>
      <ChevronDown size={14} color={color.muted} strokeWidth={2.5} />
    </Pressable>
  );
}
