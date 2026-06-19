import * as Haptics from "expo-haptics";
import React, { useCallback, useState, useEffect } from "react";
import { Keyboard, Dimensions } from "react-native";
import Animated, {
  SharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { InputFooterActions } from "./InputFooterActions";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MainTextInput } from "./MainTextInput";
import { RecordingInline } from "./RecordingInline";
import { Divider } from "../Divider";

import { Box } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, usePermissions } from "@/hooks";
import type { DictationStatus } from "@/hooks/useVoiceDictation";
import { isIOS, AppToast } from "@/utils";

interface ExpressiveInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  onMicPress: () => void;
  onTranslate: () => void;
  isTranslating?: boolean;
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
    onStop: () => void;
    onCancel: () => void;
    onConfirm: () => void;
    capturedUri: string | null;
    meteringData?: number[];
  };
  canTranslate?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const ExpressiveInput = React.memo(
  ({
    value,
    onChangeText,
    onClear,
    onMicPress,
    onTranslate,
    isTranslating = false,
    sourceLang,
    targetLang,
    onSwap,
    onSourceChange,
    onTargetChange,
    dictationState,
    canTranslate = true,
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
      onStop,
      onCancel,
      onConfirm,
      capturedUri,
      meteringData = [],
    } = dictationState;

    const isInitializing = dictationStatus === "initializing";
    const isRecording = dictationStatus === "recording";
    const isProcessing = dictationStatus === "processing";
    const isPreview = dictationStatus === "preview";
    const isActive = isRecording || isProcessing || isPreview;

    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
      const showEvent = isIOS ? "keyboardWillShow" : "keyboardDidShow";
      const hideEvent = isIOS ? "keyboardWillHide" : "keyboardDidHide";

      const showSub = Keyboard.addListener(showEvent, (): void =>
        setIsKeyboardVisible(true),
      );
      const hideSub = Keyboard.addListener(hideEvent, (): void =>
        setIsKeyboardVisible(false),
      );

      return (): void => {
        showSub.remove();
        hideSub.remove();
      };
    }, []);

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      onFocus?.();
    }, [onFocus]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
      onBlur?.();
    }, [onBlur]);

    const handleCancelPress = useCallback(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onCancel();
    }, [onCancel]);

    const progress =
      maxDurationMs > 0 ? Math.min(elapsedMs / maxDurationMs, 1) : 0;

    const handleClear = useCallback(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClear();
    }, [onClear]);

    const handleRightButtonPress = useCallback(async () => {
      if (isRecording) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onStop();
      } else if (isPreview) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onConfirm();
      } else if (value.length > 0) {
        const isTargetLangValid = targetLang !== "none" && targetLang !== "";
        if (!isTargetLangValid) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          AppToast.error("Target Language Required", {
            description: "Please select a language to translate into.",
            duration: 3000,
          });
          return;
        }
        if (!canTranslate) return; // e.g., source text too short
        onTranslate();
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onMicPress();
      }
    }, [
      isRecording,
      isPreview,
      value.length,
      onStop,
      onConfirm,
      onTranslate,
      onMicPress,
    ]);

    const isTargetLangValid = targetLang !== "none" && targetLang !== "";
    const isGlobalDisabled = isTranslating || isProcessing || isInitializing;

    // If there is text, the button is "Translate" and needs a valid targetLang.
    // If there is no text, the button is "Mic" and does NOT need a targetLang.
    const isDisabled =
      value.length > 0
        ? isGlobalDisabled || !canTranslate || !isTargetLangValid
        : isGlobalDisabled;

    // Animated scale: card lifts up subtly when focused or active
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
        // Animated shadow radius widens when active
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

    // Static per-state accent border color and shadow color (these can't animate in RN)
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
          style={{
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.sm,
            width: "100%",
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
              maxDurationMs={maxDurationMs}
              capturedUri={capturedUri}
              meteringData={meteringData}
            />
          </Box>
        ) : (
          <MainTextInput
            value={value}
            onChangeText={onChangeText}
            maxChars={maxChars}
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
          isTranslating={isTranslating}
          isDisabled={isDisabled}
          canTranslate={canTranslate}
          isKeyboardVisible={isKeyboardVisible}
          progress={progress}
          handleCancelPress={handleCancelPress}
          handleClear={handleClear}
          handleRightButtonPress={handleRightButtonPress}
        />
      </Animated.View>
    );
  },
);
