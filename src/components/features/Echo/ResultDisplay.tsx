import * as Haptics from "expo-haptics";
import React, { useState } from "react";

import { ScrollableTextBox } from "../../ScrollableTextBox";

import { Box, Text, Pressable } from "@/components/ui";
import { FLAG_MAP } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface ResultDisplayProps {
  transcription: string | null;
  translation: string | null;
  defaultTab?: "Translation" | "Transcription";
  onTabChange?: (tab: "Translation" | "Transcription") => void;
  isDark?: boolean;
  sourceLang?: string | null;
  targetLang?: string | null;
  isLoading?: boolean;
}

/**
 * ResultDisplay
 *
 * Self-contained tabbed view for transcription/translation results.
 * Manages its own active tab state internally. Parent can listen
 * via `onTabChange` if it needs to know (e.g. for a Copy button).
 */
export const ResultDisplay: React.FC<ResultDisplayProps> = React.memo(
  ({
    transcription,
    translation,
    defaultTab = "Translation",
    onTabChange,
    isDark = false,
    sourceLang,
    targetLang,
    isLoading = false,
  }) => {
    const [activeTab, setActiveTab] = useState<"Translation" | "Transcription">(
      defaultTab,
    );

    const { color } = useTheme();
    const brandPrimary = color.secondary;

    const handleTabPress = React.useCallback(
      (tab: "Translation" | "Transcription"): void => {
        Haptics.selectionAsync();
        setActiveTab(tab);
        onTabChange?.(tab);
      },
      [onTabChange],
    );

    return (
      <Box>
        <Box
          style={{
            flexDirection: "row",
            alignItems: "stretch",
            justifyContent: "space-between",
            marginBottom: spacing.md,
          }}
        >
          <Box
            style={{
              flexDirection: "row",
              borderRadius: borderRadius.xl,
              padding: spacing.xs,
              flex: 1,
              backgroundColor: color.surface,
              borderColor: color.border,
              borderWidth: 1,
            }}
          >
            <Pressable
              feedback="none"
              onPress={() => handleTabPress("Translation")}
              style={[
                {
                  flex: 1,
                  paddingVertical: spacing.md,
                  borderRadius: borderRadius.lg,
                  alignItems: "center",
                },
                activeTab === "Translation" && {
                  backgroundColor: brandPrimary,
                },
              ]}
            >
              <Text
                variant="bodySmall"
                style={{
                  color:
                    activeTab === "Translation"
                      ? color.onSecondary
                      : color.muted,
                }}
              >
                Translated (
                {targetLang
                  ? `${FLAG_MAP[targetLang] || ""} ${targetLang.toUpperCase()}`
                  : ""}
                )
              </Text>
            </Pressable>
            <Pressable
              feedback="none"
              onPress={() => handleTabPress("Transcription")}
              style={[
                {
                  flex: 1,
                  paddingVertical: spacing.md,
                  borderRadius: borderRadius.lg,
                  alignItems: "center",
                },
                activeTab === "Transcription" && {
                  backgroundColor: brandPrimary,
                },
              ]}
            >
              <Text
                variant="bodySmall"
                style={{
                  color:
                    activeTab === "Transcription"
                      ? color.onSecondary
                      : color.muted,
                }}
              >
                Original (
                {sourceLang
                  ? `${FLAG_MAP[sourceLang] || ""} ${sourceLang.toUpperCase()}`
                  : ""}
                )
              </Text>
            </Pressable>
          </Box>
        </Box>

        <ScrollableTextBox
          text={activeTab === "Translation" ? translation : transcription}
          height={350}
          variant="default"
          isLoading={isLoading && activeTab === "Translation"}
        />
      </Box>
    );
  },
);
