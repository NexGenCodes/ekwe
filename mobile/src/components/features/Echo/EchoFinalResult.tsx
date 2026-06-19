import * as Haptics from "expo-haptics";
import { Zap, CheckCircle2 } from "lucide-react-native";
import React from "react";

import { ResultDisplay } from "./ResultDisplay";
import { AnimatedCopyButton } from "../../AnimatedCopyButton";
import { Badge } from "../../Badge";

import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { EchoStep } from "@/types/echo";

interface EchoFinalResultProps {
  transcription: string | null;
  translation: string | null;
  sourceLang: string | null;
  targetLang: string;
  audioDuration?: number;
  isDark: boolean;
  setStep: (step: EchoStep) => void;
  handleClose: () => void;
}

export const EchoFinalResult: React.FC<EchoFinalResultProps> = React.memo(
  ({
    transcription,
    translation,
    sourceLang,
    targetLang,
    isDark,
    setStep,
    handleClose,
  }) => {
    const { color } = useTheme();
    const brandPrimary = color.brand;

    const [activeTab, setActiveTab] = React.useState<
      "Translation" | "Transcription"
    >("Translation");

    const handleTabChange = React.useCallback(
      (tab: "Translation" | "Transcription") => {
        setActiveTab(tab);
      },
      [],
    );

    return (
      <>
        <ResultDisplay
          transcription={transcription}
          translation={translation}
          defaultTab="Translation"
          onTabChange={handleTabChange}
          isDark={isDark}
          sourceLang={sourceLang}
          targetLang={targetLang}
        />

        <Box
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: spacing.sm,
            marginBottom: spacing.md,
          }}
        >
          <Badge
            label="Echo Processed"
            variant="primary"
            icon={<CheckCircle2 size={12} color={brandPrimary} />}
          />
          {sourceLang && targetLang && (
            <Badge
              label={`${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}`}
              variant="primary"
            />
          )}
        </Box>

        <Box style={{ flexDirection: "row", gap: spacing.md }}>
          <Pressable
            feedback="opacity"
            onPress={() => {
              Haptics.selectionAsync();
              setStep("TranscribeResult");
            }}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              paddingVertical: spacing.md,
              borderWidth: 1,
              borderRadius: borderRadius.xl,
              borderColor: color.border,
            }}
          >
            <Zap size={16} color={brandPrimary} />
            <Text variant="bodySmall" style={{ color: brandPrimary }}>
              Re-translate
            </Text>
          </Pressable>

          <AnimatedCopyButton
            textToCopy={
              activeTab === "Translation" ? translation! : transcription!
            }
            size={16}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              paddingVertical: spacing.md,
              borderWidth: 1,
              borderRadius: borderRadius.xl,
              borderColor: color.border,
            }}
          >
            <Text variant="bodySmall" style={{ color: color.foreground }}>
              Copy
            </Text>
          </AnimatedCopyButton>

          <Pressable
            feedback="opacity"
            onPress={handleClose}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              paddingVertical: spacing.md,
              borderWidth: 1,
              borderRadius: borderRadius.xl,
              backgroundColor: brandPrimary,
            }}
          >
            <CheckCircle2 size={16} color={color.onBrand} />
            <Text variant="bodySmall" style={{ color: color.onBrand }}>
              Done
            </Text>
          </Pressable>
        </Box>
      </>
    );
  },
);
