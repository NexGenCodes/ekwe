import X from "lucide-react-native/icons/x";
import AlertCircle from "lucide-react-native/icons/circle-alert";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DimensionValue } from "react-native";

import { EchoPreviewStep } from "./EchoPreviewStep";
import { EchoFinalResult } from "./EchoFinalResult";
import { EchoLanguagePicker } from "./EchoLanguagePicker";
import { EchoProcessingStep } from "./EchoProcessingStep";
import { EchoTranslationConfig } from "./EchoTranslationConfig";
import { Badge } from "../../Badge";
import { IconContainer } from "../../IconContainer";
import { Sheet } from "../../ui/Sheet";

import { Box, Text, Pressable } from "@/components/ui";
import { STEP_METADATA } from "@/constants/echo";
import { LANGUAGES } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useEchoFlow } from "@/hooks/echo";
import { useAudioWaveformPlayback } from "@/hooks/audio";
import { useTheme } from "@/hooks/ui";
import { initAuth } from "@/services/auth";
import { EchoProps, EchoStep } from "@/types/echo";
import { withAlpha } from "@/utils/color";
import { formatSourceApp } from "@/utils/formatSource";
import { formatDuration } from "@/utils/formatDuration";

const STEP_MAX_HEIGHTS: Record<EchoStep, DimensionValue> = {
  PickLanguage: "46%",
  Transcribing: "52%",
  TranscribeResult: "80%",
  Translating: "52%",
  FullResult: "80%",
  Preview: "45%",
  Error: "45%",
};

export const Echo = (props: EchoProps): React.ReactElement => {
  useEffect(() => {
    initAuth();
  }, []);

  const { onClose } = props;

  // The native player is created below; `useEchoFlow` may call its release (on
  // dismiss/background) before the player instance exists in this render, so
  // hand it a ref-backed callback that resolves to the latest controller.
  const playerReleaseRef = useRef<() => void>(() => {});

  const {
    step,
    setStep,
    selectedLang,
    setSelectedLang,
    detectedLang,
    targetLang,
    setTargetLang,
    transcription,
    translation,
    audioUri,
    sourceApp,
    isResolving,
    convertedWaveform,
    convertedDurationMs,
    handleTranscribe,
    handleTranslate,
    cancelProcessing,
    retryOperation,
    resolveRetryable,
    audioDuration,
    error,
    uploadProgress,
    autoCopied,
    onDismiss,
    autoLanguageDetect,
  } = useEchoFlow(props, () => playerReleaseRef.current());

  const { color } = useTheme();

  const [resultTab, setResultTab] = useState<"Translated" | "Original">(
    "Translated",
  );

  // The source-audio player stays "active" (i.e. won't auto-pause) across the
  // Preview, TranscribeResult, and the FullResult Original tab, so the speaker
  // button in the results can play the original recording. It pauses everywhere
  // else — while transcribing/translating and on the Translated tab.
  const playerActive =
    step === "Preview" ||
    step === "TranscribeResult" ||
    (step === "FullResult" && resultTab === "Original");

  const player = useAudioWaveformPlayback(
    audioUri || null,
    convertedWaveform,
    { active: playerActive, durationMs: convertedDurationMs },
  );

  // Keep the flow's release hook pointed at the live player controller.
  useEffect(() => {
    playerReleaseRef.current = player.release;
  }, [player.release]);

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

  const handleClose = useCallback((): void => {
    if (step === "Transcribing" || step === "Translating") return;
    onDismiss();
    onClose?.();
  }, [onDismiss, onClose, step]);

  const handleLanguageSelected = useCallback(
    (code: string): void => {
      setSelectedLang(code);
      setStep("Preview");
    },
    [setSelectedLang, setStep],
  );

  // Stable footer for the Preview step. It's rendered as `children` of the
  // memoized EchoPreviewStep, so it must NOT be rebuilt each parent render
  // (Echo re-renders ~2Hz on audio status ticks) — a fresh element identity
  // would silently defeat that memo. Memoizing on language + theme keeps it
  // identical across status ticks.
  const previewFooter = useMemo(
    () => (
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
            color: color.brand,
          }}
        >
          {selectedLangName}
        </Text>
        <Pressable
          feedback="opacity"
          onPress={() => setStep("PickLanguage")}
          accessibilityLabel="Change language"
          style={{
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: borderRadius["2xl"],
            backgroundColor: color.brand,
          }}
        >
          <Text variant="bodySmall" style={{ color: color.onBrand }}>
            Change
          </Text>
        </Pressable>
      </Box>
    ),
    [
      selectedLang,
      selectedLangName,
      color.border,
      color.muted,
      color.brand,
      color.onBrand,
      setStep,
    ],
  );

  const renderStepContent = (currentStep: EchoStep): React.ReactElement => {
    switch (currentStep) {
      case "PickLanguage":
        return (
          <EchoLanguagePicker
            selectedLang={selectedLang}
            onSelect={handleLanguageSelected}
          />
        );

      case "Preview":
        return (
          <EchoPreviewStep
            player={player}
            isResolving={isResolving}
            peaks={convertedWaveform}
            onTranscribe={handleTranscribe}
          >
            {previewFooter}
          </EchoPreviewStep>
        );

      case "Transcribing":
        return (
          <EchoProcessingStep
            title={STEP_METADATA.Transcribing.title}
            uploadingLabel="Uploading your audio…"
            processingLabel="Processing your audio…"
            uploadProgress={uploadProgress}
            durationLabel={formatDuration(audioDuration)}
            onCancel={cancelProcessing}
          />
        );

      case "TranscribeResult":
        return (
          <EchoTranslationConfig
            step={currentStep}
            selectedLang={selectedLang}
            detectedLang={detectedLang}
            targetLang={targetLang}
            transcription={transcription}
            availableTargetList={availableTargetList}
            setTargetLang={setTargetLang}
            handleTranslate={handleTranslate}
            audioPlayer={player}
            autoLanguageDetect={autoLanguageDetect}
          />
        );

      case "Translating": {
        const charCount = transcription?.trim().length ?? 0;
        const wordCount =
          transcription?.trim().split(/\s+/).filter(Boolean).length ?? 0;
        return (
          <EchoProcessingStep
            title={STEP_METADATA.Translating.title}
            uploadingLabel="Sending translation request…"
            processingLabel="Generating translation…"
            briefPhaseLabel="Sending translation request…"
            uploadProgress={null}
            reassuranceLabel="Translations can take a few seconds. Still working…"
            durationLabel={
              transcription
                ? `${charCount.toLocaleString()} chars · ${wordCount.toLocaleString()} words`
                : undefined
            }
            onCancel={cancelProcessing}
          />
        );
      }

      case "FullResult":
        return (
          <EchoFinalResult
            transcription={transcription}
            translation={translation}
            sourceLang={detectedLang}
            targetLang={targetLang}
            setStep={setStep}
            handleClose={handleClose}
            activeTab={resultTab}
            onTabChange={setResultTab}
            audioPlayer={player}
            copied={autoCopied}
          />
        );
      case "Error":
        return (
          <Box
            style={{
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: spacing.xl,
            }}
          >
            <Box
              style={{
                width: 64,
                height: 64,
                borderRadius: borderRadius["2xl"],
                alignItems: "center",
                justifyContent: "center",
                marginBottom: spacing.lg,
                backgroundColor: withAlpha(color.error, 0.08),
              }}
            >
              <AlertCircle size={32} color={color.error} />
            </Box>
            <Text
              variant="body"
              style={{
                textAlign: "center",
                marginBottom: spacing.sm,
                paddingHorizontal: spacing.lg,
                color: color.foreground,
              }}
            >
              {error || "An unexpected error occurred"}
            </Text>
            <Text
              variant="bodySmall"
              style={{
                textAlign: "center",
                marginBottom: spacing.lg,
                color: color.muted,
              }}
            >
              Please check your connection and try again.
            </Text>
            {resolveRetryable && (
              <Pressable
                feedback="opacity"
                onPress={() => void retryOperation()}
                accessibilityLabel="Try again"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  borderRadius: borderRadius["2xl"],
                  gap: spacing.sm,
                  backgroundColor: color.brand,
                }}
              >
                <RefreshCw size={16} color={color.onBrand} />
                <Text variant="bodySmall" style={{ color: color.onBrand }}>
                  Try Again
                </Text>
              </Pressable>
            )}
          </Box>
        );
      default:
        return <Box />;
    }
  };

  const stepMeta = STEP_METADATA[step];
  const isProcessing = step === "Transcribing" || step === "Translating";

  return (
    <Sheet
      visible
      onClose={handleClose}
      maxHeight={STEP_MAX_HEIGHTS[step]}
    >
      <Box
        style={{
          paddingHorizontal: spacing.lg,
          paddingBottom: isProcessing ? spacing.sm : spacing["2xl"],
          paddingTop: isProcessing ? spacing.sm : spacing.md,
        }}
      >
        {!isProcessing && (
          <>
            {/* Header */}
            <Box
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: spacing.lg,
                marginTop: spacing.sm,
              }}
            >
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: borderRadius.sm,
                backgroundColor: color.brand,
              }}
            />
            <Text variant="bodySmall" style={{ color: color.muted }}>
              ECHO
            </Text>
          </Box>

          <Pressable
            feedback="opacity"
            onPress={handleClose}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityLabel="Close Echo"
          >
            <IconContainer size="sm" variant="muted">
              <X size={16} color={color.foreground} />
            </IconContainer>
          </Pressable>

          {stepMeta.showBadge && (
            <Box
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <Badge label={formatSourceApp(sourceApp)} variant="primary" />
            </Box>
          )}
            </Box>
          </>
        )}

        {/* Step Content */}
        {renderStepContent(step)}
      </Box>
    </Sheet>
  );
};
