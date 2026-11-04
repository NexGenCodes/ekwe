import Mic from "lucide-react-native/icons/mic";
import X from "lucide-react-native/icons/x";
import Square from "lucide-react-native/icons/square";
import Wand from "lucide-react-native/icons/wand";
import React, { useMemo } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { IconButton } from "@/components/IconButton";

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
  isDisabled: boolean;
  canConvert: boolean;

  hasRecording: boolean;

  isConverting: boolean;

  isAudioLoading: boolean;
  isKeyboardVisible: boolean;
  progress: number;
  handleCancelPress: () => void;
  handleClear: () => void;
  handleDeleteAudio: () => void;
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
    isDisabled,
    canConvert,
    hasRecording,
    isConverting,
    isAudioLoading,
    isKeyboardVisible,
    progress,
    handleCancelPress,
    handleClear,
    handleDeleteAudio,
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

    const hasSource = valueLength > 0 || hasRecording;

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
          (hasSource || isPreview) &&
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
                    ? canConvert
                      ? color.brand
                      : color.border
                    : color.brand,
          },
          pressed &&
            !isProcessing &&
            (isPreview || isRecording || hasSource) && {
              transform: [{ scale: 0.95 }],
            },
          isDisabled && {
            opacity: opacity.disabled,
          },
        ],
      [
        hasSource,
        valueLength,
        isRecording,
        isProcessing,
        isPreview,
        color,
        canConvert,
        isDisabled,
      ],
    );

    const actionContent = useMemo(() => {
      if (isConverting || isAudioLoading) {
        return (
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Spinner size="sm" color={color.onBrand} />
            <Text variant="body" style={{ color: color.onBrand }}>
              {isConverting ? "Converting…" : "Preparing…"}
            </Text>
          </Box>
        );
      }
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

      if (isPreview || hasSource) {
        return (
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Text variant="body" style={{ color: color.onBrand }}>
              Convert
            </Text>
            <Wand size={18} color={color.onBrand} strokeWidth={2.5} />
          </Box>
        );
      }
      return <Mic size={24} color={color.onBrand} strokeWidth={2.5} />;
    }, [
      isConverting,
      isAudioLoading,
      isRecording,
      isProcessing,
      isPreview,
      hasSource,
      color.onBrand,
    ]);

    const actionLabel = useMemo(() => {
      if (isConverting) return "Converting to voice";
      if (isAudioLoading) return "Preparing audio";
      if (isPreview) return "Convert recording to voice";
      if (isRecording) return "Stop recording";
      if (hasSource) return "Convert to voice";
      return "Start voice dictation";
    }, [isConverting, isAudioLoading, isPreview, isRecording, hasSource]);

    const isClearDisabled = isConverting || isAudioLoading || isProcessing;

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
          {}
          <Box style={{ flexDirection: "row", gap: spacing.md }}>
            {hasRecording ? (
              <Box style={{ alignItems: "center", gap: spacing.xs }}>
                <IconButton
                  accessibilityLabel="Clear audio"
                  onPress={handleDeleteAudio}
                  disabled={isClearDisabled}
                  backgroundColor={color.surface}
                  size={52}
                  icon={<X size={22} color={color.error} strokeWidth={2.5} />}
                />
                {!isKeyboardVisible && (
                  <Text variant="caption" style={{ color: color.error }}>
                    Clear
                  </Text>
                )}
              </Box>
            ) : isActive ? (
              <Box style={{ alignItems: "center", gap: spacing.xs }}>
                <IconButton
                  accessibilityLabel="Clear recording"
                  onPress={handleCancelPress}
                  disabled={isClearDisabled}
                  backgroundColor={color.surface}
                  size={52}
                  icon={<X size={22} color={color.error} strokeWidth={2.5} />}
                />
                {!isKeyboardVisible && (
                  <Text variant="caption" style={{ color: color.error }}>
                    Clear
                  </Text>
                )}
              </Box>
            ) : valueLength > 0 ? (
              <Box style={{ alignItems: "center", gap: spacing.xs }}>
                <IconButton
                  accessibilityLabel="Clear text"
                  onPress={handleClear}
                  disabled={isClearDisabled}
                  backgroundColor={color.surface}
                  size={52}
                  icon={<X size={22} color={color.muted} strokeWidth={2.5} />}
                />
                {!isKeyboardVisible && (
                  <Text variant="caption" style={{ color: color.muted }}>
                    Clear
                  </Text>
                )}
              </Box>
            ) : (
              <Box style={{ width: 52, height: 52 }} />
            )}
          </Box>

          {}
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
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              accessibilityState={{
                disabled: isDisabled,
                busy:
                  isConverting ||
                  isProcessing ||
                  isInitializing ||
                  isAudioLoading,
              }}
              style={btnStyle}
              onPress={handleRightButtonPress}
              disabled={isDisabled}
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
