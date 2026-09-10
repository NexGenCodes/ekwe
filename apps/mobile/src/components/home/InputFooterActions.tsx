import Mic from "lucide-react-native/icons/mic";
import X from "lucide-react-native/icons/x";
import Square from "lucide-react-native/icons/square";
import Trash2 from "lucide-react-native/icons/trash";
import Send from "lucide-react-native/icons/send";
import React, { useMemo } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { IconButton } from "../IconButton";

import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface InputFooterActionsProps {
  valueLength: number;
  isActive: boolean;
  isInitializing: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isPreview: boolean;
  isTranslating: boolean;
  isDisabled: boolean;
  canTranslate: boolean;
  isKeyboardVisible: boolean;
  progress: number;
  handleCancelPress: () => void;
  handleClear: () => void;
  handleRightButtonPress: () => void;
}

export const InputFooterActions = React.memo(
  ({
    valueLength,
    isActive,
    isInitializing,
    isRecording,
    isProcessing,
    isPreview,
    isTranslating,
    isDisabled,
    canTranslate,
    isKeyboardVisible,
    progress,
    handleCancelPress,
    handleClear,
    handleRightButtonPress,
  }: InputFooterActionsProps) => {
    const { color } = useTheme();

    const radius = 26;
    const strokeWidth = 3;
    const circumference = 2 * Math.PI * radius;

    const progressSV = useSharedValue(0);
    React.useEffect(() => {
      progressSV.value = withTiming(progress, {
        duration: 100,
        easing: Easing.linear,
      });
    }, [progress, progressSV]);

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: circumference - progressSV.value * circumference,
    }));

    // no-op in production; previous dev-only contrast checks were removed per request

    const btnStyle = useMemo(
      () =>
        ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
          {
            width: 52,
            height: 52,
            borderRadius: borderRadius["2xl"],
            alignItems: "center" as const,
            justifyContent: "center" as const,
            boxShadow: shadows.soft,
          },
          (valueLength > 0 || isPreview) &&
            ({
              width: "auto",
              paddingHorizontal: spacing.lg,
            } as const),
          {
            backgroundColor:
              isRecording || isProcessing
                ? color.error
                : isPreview
                  ? color.brand
                  : valueLength > 0
                    ? canTranslate
                      ? color.brand
                      : color.border
                    : color.brand,
          },
          pressed &&
            !isProcessing &&
            (isPreview || isRecording || (valueLength > 0 && canTranslate)) && {
              transform: [{ scale: 0.95 }],
            },
          isDisabled && {
            opacity: opacity.disabled,
          },
        ],
      [
        valueLength,
        isRecording,
        isProcessing,
        isPreview,
        color,
        canTranslate,
        isDisabled,
      ],
    );

    /* ── Action button content — changes by state ── */
    const actionContent = useMemo(() => {
      if (isRecording) {
        return (
          <Square
            size={22}
            color={color.onBrand}
            fill={color.onBrand}
            strokeWidth={2.5}
          />
        );
      }
      if (isProcessing) {
        return <Spinner size="sm" color={color.onBrand} />;
      }
      if (isPreview) {
        return <Send size={18} color={color.onBrand} strokeWidth={2.5} />;
      }
      if (valueLength > 0) {
        return (
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Text variant="body" style={{ color: color.onBrand }}>
              {isTranslating ? "Translating..." : "Translate"}
            </Text>
            <Send size={18} color={color.onBrand} strokeWidth={2.5} />
          </Box>
        );
      }
      return <Mic size={24} color={color.onBrand} strokeWidth={2.5} />;
    }, [
      isRecording,
      isProcessing,
      isPreview,
      valueLength,
      isTranslating,
      color.onBrand,
    ]);

    const actionLabel = useMemo(() => {
      if (isPreview) return "Confirm audio and transcribe";
      if (isRecording) return "Stop recording";
      if (valueLength > 0)
        return isTranslating ? "Translating" : "Translate text";
      return "Start voice dictation";
    }, [isPreview, isRecording, valueLength, isTranslating]);

    const actionDisabled = isTranslating || isProcessing || isInitializing;

    return (
      <Box style={{ paddingHorizontal: spacing.lg }}>
        <Box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
            width: "100%",
          }}
        >
          {/* ── Left side ── */}
          <Box style={{ flexDirection: "row", gap: spacing.md }}>
            {isActive ? (
              <Box style={{ alignItems: "center", gap: spacing.xs }}>
                <IconButton
                  accessibilityLabel="Discard recording"
                  onPress={handleCancelPress}
                  backgroundColor={color.surface}
                  size={52}
                  icon={
                    <Trash2 size={22} color={color.error} strokeWidth={2} />
                  }
                />
                {!isKeyboardVisible && (
                  <Text variant="caption" style={{ color: color.error }}>
                    Cancel
                  </Text>
                )}
              </Box>
            ) : valueLength > 0 ? (
              <Box style={{ alignItems: "center", gap: spacing.xs }}>
                <IconButton
                  accessibilityLabel="Clear text"
                  onPress={handleClear}
                  backgroundColor={color.surface}
                  size={52}
                  icon={<X size={22} color={color.muted} strokeWidth={2.5} />}
                />
                <Text variant="caption" style={{ color: color.muted }}>
                  Clear
                </Text>
              </Box>
            ) : (
              <Box style={{ width: 52, height: 52 }} />
            )}
          </Box>

          {/* ── Right side: Action button (always mounted) ── */}
          <Box
            style={{
              minWidth: 60,
              height: 60,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {(isRecording || isProcessing) && (
              <Box
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              >
                <Svg width={60} height={60} viewBox="0 0 60 60">
                  <AnimatedCircle
                    cx="30"
                    cy="30"
                    r={radius}
                    stroke={color.error}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circumference}
                    animatedProps={animatedProps}
                    transform="rotate(-90 30 30)"
                  />
                </Svg>
              </Box>
            )}
            <Pressable
              accessibilityLabel={actionLabel}
              style={btnStyle}
              onPress={handleRightButtonPress}
              disabled={actionDisabled}
              hitSlop={15}
            >
              {actionContent}
            </Pressable>
          </Box>
        </Box>
      </Box>
    );
  },
);
