import { triggerHaptic } from "@/utils/haptics";
import Zap from "lucide-react-native/icons/zap";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import React from "react";

import { TextBox } from "@/components/features/Echo/TextBox";

import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";

import { Box, Text, Pressable } from "@/components/ui";
import { getLanguageFlag } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";
import { EchoStep } from "@/types/echo";

interface EchoFinalResultProps {
  transcription: string | null;
  translation: string | null;
  sourceLang: string | null;
  targetLang: string;
  setStep: (step: EchoStep) => void;
  handleClose: () => void;
  activeTab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  audioPlayer: WaveformPlaybackController | null;
  copied?: boolean;
}

type ResultTab = "Translated" | "Original";

interface ResultTabsProps {
  sourceLang?: string | null;
  targetLang?: string | null;
  activeTab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
}

const langLabel = (
  code: string | null | undefined,
): { flag: string; name: string } => {
  const upper = code?.toUpperCase() ?? "";
  return { flag: code ? getLanguageFlag(code) : "🌐", name: upper || "—" };
};

const ResultTabs: React.FC<ResultTabsProps> = React.memo(
  ({ sourceLang, targetLang, activeTab, onTabChange }) => {
    const { color } = useTheme();

    const src = langLabel(sourceLang);
    const tgt = langLabel(targetLang);

    const tabs: { key: ResultTab; label: string }[] = [
      { key: "Original", label: `${src.flag} Original · ${src.name}` },
      { key: "Translated", label: `${tgt.flag} Translated · ${tgt.name}` },
    ];

    return (
      <Box
        style={{
          flexDirection: "row",
          borderRadius: borderRadius["2xl"],
          padding: 3,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: color.border,
          backgroundColor: color.surface,
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              feedback="opacity"
              onPress={() => onTabChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.xs,
                borderRadius: borderRadius["2xl"] - 4,
                backgroundColor: active ? color.brand : "transparent",
              }}
            >
              <Text variant="body">{tab.label.split(" ")[0]}</Text>
              <Text
                variant="caption"
                numberOfLines={1}
                style={{
                  fontWeight: "600",
                  color: active ? color.onBrand : color.muted,
                }}
              >
                {tab.label.split(" ").slice(1).join(" ")}
              </Text>
            </Pressable>
          );
        })}
      </Box>
    );
  },
);

export const EchoFinalResult: React.FC<EchoFinalResultProps> = React.memo(
  ({
    transcription,
    translation,
    sourceLang,
    targetLang,
    setStep,
    handleClose,
    activeTab,
    onTabChange,
    audioPlayer,
    copied = false,
  }) => {
    const { color } = useTheme();

    const isTranslated = activeTab === "Translated";
    const activeText = isTranslated ? translation : transcription;
    const activeLang = isTranslated ? targetLang : sourceLang;

    return (
      <>
        <ResultTabs
          activeTab={activeTab}
          onTabChange={onTabChange}
          sourceLang={sourceLang}
          targetLang={targetLang}
        />

        <TextBox
          key={activeTab}
          text={activeText}
          height={330}
          variant={isTranslated ? "accent" : "default"}
          lead={isTranslated ? "Translation" : "Transcription"}
          lang={activeLang}
          withCheck
          copied={isTranslated ? copied : false}
          audioPlayer={isTranslated ? null : audioPlayer}
          allowTts={isTranslated}
        />

        <Box style={{ flexDirection: "row", gap: spacing.md }}>
          <Pressable
            feedback="opacity"
            onPress={() => {
              triggerHaptic("selection");
              setStep("TranscribeResult");
            }}
            style={{
              flex: 1,
              minHeight: 54,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderWidth: 1,
              borderRadius: borderRadius["2xl"],
              borderColor: color.border,
            }}
          >
            <Zap size={16} color={color.brand} />
            <Text variant="body" style={{ color: color.brand }}>
              Re-translate
            </Text>
          </Pressable>

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
              borderRadius: borderRadius["2xl"],
              backgroundColor: color.brand,
            }}
          >
            <CheckCircle2 size={16} color={color.onBrand} />
            <Text variant="body" style={{ color: color.onBrand }}>
              Done
            </Text>
          </Pressable>
        </Box>
      </>
    );
  },
);
