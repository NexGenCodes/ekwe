import { Mic, X, Square, Trash2, Send } from "lucide-react-native";
import React, { useMemo } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, { useAnimatedProps } from "react-native-reanimated";
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

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: circumference - progress * circumference,
    }));

    // no-op in production; previous dev-only contrast checks were removed per request

    const micBtnStyle = useMemo(
      () =>
        ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
          {
            width: 52,
            height: 52,
            borderRadius: borderRadius["2xl"],
            alignItems: "center" as const,
            justifyContent: "center" as const,
            ...shadows.soft,
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
                  ? color.secondary
                  : valueLength > 0
                    ? canTranslate
                      ? color.secondary
                      : color.border
                    : color.secondary,
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

    return (
      <Box style={{ paddingHorizontal: spacing.lg }}>
        {isActive ? (
          <Box
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-end",
              width: "100%",
            }}
          >
            <Box style={{ flexDirection: "row", gap: spacing.md }}>
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
            </Box>

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
                accessibilityLabel={
                  isPreview
                    ? "Confirm audio and transcribe"
                    : isRecording
                      ? "Stop recording"
                      : "Recording action"
                }
                style={micBtnStyle}
                onPress={handleRightButtonPress}
                disabled={isTranslating || isProcessing || isInitializing}
                hitSlop={15}
              >
                {isRecording ? (
                  <Square
                    size={22}
                    color={color.onSecondary}
                    fill={color.onSecondary}
                    strokeWidth={2.5}
                  />
                ) : isProcessing ? (
                  <Spinner size="sm" color={color.onSecondary} />
                ) : (
                  <Send size={18} color={color.onSecondary} strokeWidth={2.5} />
                )}
              </Pressable>
            </Box>
          </Box>
        ) : (
          <Box style={{ width: "100%" }}>
            <Box
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-end",
                width: "100%",
              }}
            >
              <Box style={{ flexDirection: "row", gap: spacing.md }}>
                {valueLength > 0 ? (
                  <Box style={{ alignItems: "center", gap: spacing.xs }}>
                    <IconButton
                      accessibilityLabel="Clear text"
                      onPress={handleClear}
                      backgroundColor={color.surface}
                      size={52}
                      icon={
                        <X size={22} color={color.muted} strokeWidth={2.5} />
                      }
                    />
                    <Text variant="caption" style={{ color: color.muted }}>
                      Clear
                    </Text>
                  </Box>
                ) : (
                  <Box style={{ width: 52, height: 52 }} />
                )}
              </Box>

              <Box
                style={{
                  minWidth: 60,
                  height: 60,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Pressable
                  accessibilityLabel={
                    valueLength > 0
                      ? isTranslating
                        ? "Translating"
                        : "Translate text"
                      : "Start voice dictation"
                  }
                  style={micBtnStyle}
                  onPress={handleRightButtonPress}
                  disabled={isTranslating || isProcessing || isInitializing}
                  hitSlop={15}
                >
                  {isInitializing ? (
                    <Spinner size="sm" color={color.onSecondary} />
                  ) : valueLength > 0 ? (
                    <Box
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.sm,
                      }}
                    >
                      <Text
                        variant="body"
                        style={{
                          color: color.onSecondary,
                        }}
                      >
                        {isTranslating ? "Translating..." : "Translate"}
                      </Text>
                      <Send
                        size={18}
                        color={color.onSecondary}
                        strokeWidth={2.5}
                      />
                    </Box>
                  ) : (
                    <Mic
                      size={24}
                      color={color.onSecondary}
                      strokeWidth={2.5}
                    />
                  )}
                </Pressable>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    );
  },
);
