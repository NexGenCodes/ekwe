import React, { useMemo } from "react";

import { EchoConfigStep } from "./EchoConfig";
import { EchoErrorStep } from "./EchoErrorStep";
import { EchoFinalResult } from "./EchoFinalResult";
import { EchoLanguagePicker } from "./EchoLanguagePicker";
import { EchoLoadingState } from "./EchoLoadingState";
import { EchoTranslationConfig } from "./EchoTranslationConfig";
import { Button } from "../../Button";

import { Box, Text } from "@/components/ui";
import { STEP_METADATA } from "@/constants/echo";
import { LANGUAGES } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import type { SharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { useTheme } from "@/hooks/ui";
import type { EchoStep } from "@/types/echo";

export interface EchoStepRendererProps {
  currentStep: EchoStep;
  userSession: object | null;
  selectedLang: string;
  detectedLang: string | null;
  targetLang: string | null;
  transcription: string | null;
  translation: string | null;
  audioDuration: number;
  error: string | null;
  player: SharedAudioPlayer | null;
  isResolving: boolean;
  isDark: boolean;
  handleLanguageSelected: (code: string) => void;
  handleTranscribe:
    | ((durationSeconds: number, waveform: number[]) => Promise<void>)
    | null;
  handleTranslate: ((targetLang: string) => Promise<void>) | null;
  setStep: (step: EchoStep) => void;
  setTargetLang: (lang: string) => void;
  handleClose: () => void;
}

/**
 * EchoStepRenderer — Extracted step-based content renderer.
 * Consolidates all renderStepContent logic into a pure, reusable component.
 */
export const EchoStepRenderer = React.memo(function EchoStepRenderer({
  currentStep,
  userSession,
  selectedLang,
  detectedLang,
  targetLang,
  transcription,
  translation,
  audioDuration,
  error,
  player,
  isResolving,
  isDark,
  handleLanguageSelected,
  handleTranscribe,
  handleTranslate,
  setStep,
  setTargetLang,
  handleClose,
}: EchoStepRendererProps): React.ReactElement {
  const { color } = useTheme();

  // Compute available target languages (default-selected only, exclude detected source)
  const availableTargetList = useMemo(
    () => LANGUAGES.filter((l) => l.defaultSelected && l.code !== detectedLang),
    [detectedLang],
  );

  const selectedLangName = useMemo(
    () =>
      selectedLang === "auto"
        ? "Auto-Detect"
        : LANGUAGES.find((l) => l.code === selectedLang)?.englishName ||
          selectedLang,
    [selectedLang],
  );

  if (!userSession || !player) {
    return (
      <Box
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: spacing["3xl"],
        }}
      >
        <Text
          variant="heading3"
          style={{ marginTop: spacing.lg, textAlign: "center" }}
        >
          Login Required
        </Text>
        <Text
          variant="bodySmall"
          style={{
            color: color.muted,
            textAlign: "center",
            marginTop: spacing.sm,
          }}
        >
          Please open the Ekwe app and log in to translate shared files.
        </Text>
      </Box>
    );
  }

  switch (currentStep) {
    case "PickLanguage":
      return (
        <EchoLanguagePicker
          selectedLang={selectedLang}
          onSelect={handleLanguageSelected}
        />
      );

    case "Config":
      return (
        <EchoConfigStep
          player={player}
          isResolving={isResolving}
          isDark={isDark}
          onTranscribe={
            handleTranscribe || ((): Promise<void> => Promise.resolve())
          }
        >
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: spacing.md,
              borderTopWidth: 1,
              marginTop: spacing.sm,
              borderTopColor: color.border,
            }}
          >
            <Text variant="bodySmall" style={{ color: color.muted }}>
              {selectedLang === "auto" ? "Language: " : "Source Language: "}
            </Text>
            <Text
              variant="bodySmall"
              style={{
                flex: 1,
                marginLeft: spacing.sm,
                color: color.secondary,
              }}
            >
              {selectedLangName}
            </Text>
            <Button
              variant="primary"
              label="Change"
              size="small"
              onPress={() => setStep("PickLanguage")}
            />
          </Box>
        </EchoConfigStep>
      );

    case "Transcribing":
      return (
        <EchoLoadingState
          title={STEP_METADATA.Transcribing.title}
          subtitle="Loading..."
        />
      );

    case "TranscribeResult":
      return (
        <EchoTranslationConfig
          step={currentStep}
          selectedLang={selectedLang}
          detectedLang={detectedLang || "auto"}
          targetLang={targetLang || ""}
          transcription={transcription || ""}
          availableTargetList={availableTargetList}
          isDark={isDark}
          setTargetLang={setTargetLang}
          handleTranslate={() => {
            if (handleTranslate && targetLang) {
              return handleTranslate(targetLang);
            }
            return Promise.resolve();
          }}
        />
      );

    case "Translating":
      return (
        <EchoLoadingState
          title="Echo is translating..."
          subtitle="Please wait while we process the translation."
        />
      );

    case "FullResult":
      return (
        <EchoFinalResult
          transcription={transcription || ""}
          translation={translation || ""}
          sourceLang={detectedLang || "auto"}
          targetLang={targetLang || ""}
          audioDuration={audioDuration}
          isDark={isDark}
          setStep={setStep}
          handleClose={handleClose}
        />
      );

    case "Error":
      return <EchoErrorStep error={error} color={color} onRetry={setStep} />;

    default:
      return <Box />;
  }
});
