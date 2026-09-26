import React, { useCallback, useState, useEffect } from "react";
import { Dimensions } from "react-native";
import Animated, {
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useKeyboardState } from "react-native-keyboard-controller";

import { InputFooterActions } from "@/components/home/InputFooterActions";
import { LanguageSwitcher } from "@/components/home/LanguageSwitcher";
import { MainTextInput } from "@/components/home/MainTextInput";
import { RecordingInline } from "@/components/home/RecordingInline";
import { Divider } from "@/components/Divider";

import { Box } from "@/components/ui";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, usePermissions } from "@/hooks";
import type { SharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import type { DictationStatus } from "@/hooks/useVoiceDictation";
import { triggerHaptic } from "@/utils";

interface ExpressiveInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  onMicPress: () => void;
  onConvert: () => void;
  sourceLang: string;
  targetLang: string;
  onSwap: () => void;
  onSourceChange: (code: string) => void;
  onTargetChange: (code: string) => void;

  dictationState: {
    status: DictationStatus;
    amplitude: SharedValue<number>;
    elapsedMs: number;
    maxDurationMs: number;

    capturedDurationMs?: number;
    onStop: () => void;
    onCancel: () => void;
    onConfirm: () => void;
    capturedUri: string | null;
    meteringData?: number[];
    interimText?: string;
    finalText?: string;
    isLive?: boolean;
  };
  canConvert?: boolean;

  hasRecording?: boolean;
  recordingUri?: string | null;

  recordingPeaks?: number[];

  recordingPlayer?: SharedAudioPlayer;
  onDeleteAudio?: () => void;

  isConverting?: boolean;

  isDormant?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const ExpressiveInput = React.memo(
  ({
    value,
    onChangeText,
    onClear,
    onMicPress,
    onConvert,
    sourceLang,
    targetLang,
    onSwap,
    onSourceChange,
    onTargetChange,
    dictationState,
    canConvert = true,
    hasRecording = false,
    recordingUri = null,
    recordingPeaks,
    recordingPlayer,
    onDeleteAudio,
    isConverting = false,
    isDormant = false,
    onFocus,
    onBlur,
  }: ExpressiveInputProps): React.ReactElement => {
    const { color } = useTheme();
    const permissions = usePermissions();
    const maxChars = permissions.textTranslationMaxChars;

    const {
      status: dictationStatus,
      amplitude,
      elapsedMs,
      maxDurationMs,
      capturedDurationMs,
      onStop,
      onCancel,
      onConfirm,
      capturedUri,
      meteringData = [],
      interimText = "",
      finalText = "",
      isLive = false,
    } = dictationState;

    const isInitializing = dictationStatus === "initializing";
    const isRecording = dictationStatus === "recording";
    const isProcessing = dictationStatus === "processing";
    const isPreview = dictationStatus === "preview";
    const isActive = isRecording || isProcessing || isPreview;

    const recordingAmp = useSharedValue(0);

    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    const [isPreviewReady, setIsPreviewReady] = useState(false);
    useEffect(() => {
      setIsPreviewReady(false);
    }, [isPreview, capturedUri, dictationStatus]);
    const handlePreviewReady = useCallback((ready: boolean) => {
      setIsPreviewReady(ready);
    }, []);

    const keyboardVisible = useKeyboardState((state) => state.isVisible);
    useEffect(() => {
      setIsKeyboardVisible(keyboardVisible);
    }, [keyboardVisible]);

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      onFocus?.();
    }, [onFocus]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
      onBlur?.();
    }, [onBlur]);

    const handleCancelPress = useCallback(async () => {
      await triggerHaptic();
      onCancel();
    }, [onCancel]);

    const progress =
      maxDurationMs > 0 ? Math.min(elapsedMs / maxDurationMs, 1) : 0;

    const handleClear = useCallback(async () => {
      await triggerHaptic();
      onClear();
    }, [onClear]);

    const handleDeleteAudio = useCallback((): void => {
      onDeleteAudio?.();
    }, [onDeleteAudio]);

    const handleRightButtonPress = useCallback(async () => {
      if (isRecording) {
        await triggerHaptic();
        onStop();
      } else if (isPreview) {
        await triggerHaptic();
        onConfirm();
      } else if (value.length > 0 || hasRecording) {
        if (value.length > 0 && !canConvert) return;
        await triggerHaptic();
        onConvert();
      } else {
        await triggerHaptic();
        onMicPress();
      }
    }, [
      isRecording,
      isPreview,
      value.length,
      hasRecording,
      onStop,
      onConfirm,
      onConvert,
      onMicPress,
      canConvert,
    ]);

    const isRecordingLoading =
      hasRecording && !!recordingUri && !!recordingPlayer
        ? !recordingPlayer.isReady || recordingPlayer.isDecoding
        : false;

    const isAudioLoading = isPreview ? !isPreviewReady : isRecordingLoading;

    const isGlobalDisabled =
      isProcessing || isInitializing || isConverting || isAudioLoading;

    const hasSource = value.length > 0 || hasRecording;
    const isDisabled = hasSource
      ? isGlobalDisabled || (value.length > 0 && !canConvert)
      : isGlobalDisabled;

    const animatedCardStyle = useAnimatedStyle(() => {
      const isActiveOrFocused =
        isRecording || isProcessing || isPreview || isFocused;
      return {
        transform: [
          {
            scale: withSpring(isActiveOrFocused ? 1.012 : 1, {
              damping: 18,
              stiffness: 200,
            }),
          },
        ],

        shadowRadius: withTiming(
          isRecording || isProcessing || isPreview ? 24 : isFocused ? 20 : 12,
          { duration: 250 },
        ),
        shadowOpacity: withTiming(
          isRecording || isProcessing || isPreview
            ? 0.18
            : isFocused
              ? 0.14
              : 0.05,
          { duration: 250 },
        ),
        elevation: withTiming(
          isRecording || isProcessing || isPreview ? 8 : isFocused ? 6 : 2,
          { duration: 250 },
        ),
      };
    });

    let activeBorderColor = color.border;
    let activeShadowColor = color.border;
    if (isRecording) {
      activeBorderColor = color.error;
      activeShadowColor = color.error;
    } else if (isProcessing) {
      activeBorderColor = color.warning;
      activeShadowColor = color.warning;
    } else if (isPreview) {
      activeBorderColor = color.success;
      activeShadowColor = color.success;
    } else if (isFocused) {
      activeBorderColor = color.brand;
      activeShadowColor = color.brand;
    }

    return (
      <Animated.View
        style={[
          {
            borderRadius: borderRadius["2xl"],
            borderWidth: 1,
            borderColor: activeBorderColor,
            shadowColor: activeShadowColor,
            shadowOffset: { width: 0, height: 6 },
            position: "relative",
            overflow: "hidden",
            backgroundColor: color.card,
            paddingVertical: spacing.md,
          },
          animatedCardStyle,
        ]}
      >
        <Box
          pointerEvents={isConverting ? "none" : "auto"}
          style={{
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.sm,
            width: "100%",
            opacity: isConverting ? opacity.disabled : 1,
          }}
        >
          <LanguageSwitcher
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSwap={onSwap}
            onSourceChange={onSourceChange}
            onTargetChange={onTargetChange}
          />
        </Box>

        {isActive ? (
          <Box
            style={{
              flex: 1,
              minHeight: Math.max(120, Dimensions.get("window").height * 0.15),
              justifyContent: "center",
              paddingHorizontal: spacing.lg,
            }}
          >
            <RecordingInline
              status={dictationStatus}
              amplitude={amplitude}
              elapsedMs={elapsedMs}
              capturedDurationMs={capturedDurationMs}
              capturedUri={capturedUri}
              meteringData={meteringData}
              isLive={isLive}
              interimText={interimText}
              finalText={finalText}
              onReadyChange={handlePreviewReady}
              dormant={isDormant}
            />
          </Box>
        ) : hasRecording && recordingUri ? (
          <Box
            pointerEvents={isConverting ? "none" : "auto"}
            style={{
              flex: 1,
              minHeight: Math.max(120, Dimensions.get("window").height * 0.15),
              justifyContent: "center",
              paddingHorizontal: spacing.lg,
              opacity: isConverting ? opacity.disabled : 1,
            }}
          >
            <RecordingInline
              status="preview"
              amplitude={recordingAmp}
              elapsedMs={0}
              capturedUri={recordingUri}
              meteringData={recordingPeaks ?? []}
              externalPlayer={recordingPlayer}
              dormant={isDormant}
            />
          </Box>
        ) : (
          <MainTextInput
            value={value}
            onChangeText={onChangeText}
            maxChars={maxChars}
            editable={!isGlobalDisabled}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        )}

        <Divider style={{ marginVertical: spacing.md }} />

        <InputFooterActions
          valueLength={value.length}
          isActive={isActive}
          isInitializing={isInitializing}
          isRecording={isRecording}
          isProcessing={isProcessing}
          isPreview={isPreview}
          isDisabled={isDisabled}
          canConvert={canConvert}
          hasRecording={hasRecording}
          isConverting={isConverting}
          isAudioLoading={isAudioLoading}
          isKeyboardVisible={isKeyboardVisible}
          progress={progress}
          handleCancelPress={handleCancelPress}
          handleClear={handleClear}
          handleDeleteAudio={handleDeleteAudio}
          handleRightButtonPress={handleRightButtonPress}
        />
      </Animated.View>
    );
  },
);
