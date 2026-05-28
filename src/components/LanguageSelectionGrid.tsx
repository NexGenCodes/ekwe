import { Check } from "lucide-react-native";
import React from "react";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

import { Box, Text, Pressable } from "@/components/ui";
import { LANGUAGES, FLAG_MAP } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface LanguageSelectionGridProps {
  selected: string[];
  onToggle: (code: string) => void;
}

export function LanguageSelectionGrid({
  selected,
  onToggle,
}: LanguageSelectionGridProps): React.ReactElement {
  const { color } = useTheme();
  const brandPrimary = color.secondary;
  const bgMain = color.background;
  const handleHex = color.border;

  return (
    <Animated.View
      entering={FadeInUp.duration(600).delay(100)}
      style={styles.gridContainer}
    >
      {LANGUAGES.map((lang, index) => {
        const code = lang.code;
        const isSelected = selected.includes(code);

        return (
          <Animated.View
            key={code}
            entering={FadeInDown.duration(300).delay(index * 30)}
            style={{ width: "48%", marginBottom: spacing.md }}
          >
            <Pressable
              onPress={() => onToggle(code)}
              style={[
                {
                  width: "100%",
                  aspectRatio: 2.2,
                  backgroundColor: isSelected ? brandPrimary : bgMain,
                  borderColor: isSelected ? brandPrimary : handleHex,
                  borderWidth: 1,
                  borderRadius: borderRadius["2xl"],
                  marginBottom: spacing.md,
                  paddingHorizontal: spacing.md,
                  flexDirection: "row",
                  alignItems: "center",
                },
              ]}
            >
              <Text variant="heading2" style={{ marginRight: spacing.sm }}>
                {FLAG_MAP[code] || "🌐"}
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  flex: 1,
                  color: isSelected ? color.onSecondary : color.foreground,
                }}
                numberOfLines={1}
              >
                {lang.englishName}
              </Text>
              {isSelected && (
                <Box style={styles.checkIcon}>
                  <Check size={18} color={color.onSecondary} strokeWidth={3} />
                </Box>
              )}
            </Pressable>
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = {
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    paddingBottom: spacing["2xl"],
  } as const,
  checkIcon: { marginLeft: spacing.xs } as const,
};
