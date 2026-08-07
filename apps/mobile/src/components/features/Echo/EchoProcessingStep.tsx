import React, { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Box, Pressable, Spinner, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useReduceMotion } from "@/hooks/ui";
import { withAlpha } from "@/utils/color";

interface EchoProcessingStepProps {
  title: string;
  uploadingLabel: string;
  processingLabel: string;
  /** Real upload fraction 0–1, or null when the request is in flight (indeterminate). */
  uploadProgress: number | null;
  durationLabel?: string | null;
  /** Shown briefly (when indeterminate) before `processingLabel`, e.g. "Sending request…". */
  briefPhaseLabel?: string;
  /** Overrides the default "still working" reassurance message. */
  reassuranceLabel?: string;
  onCancel?: () => void;
}

const ELAPSED_REASSURE_MS = 6_000;
const BRIEF_PHASE_MS = 1_400;

export const EchoProcessingStep = React.memo(
  ({
    title,
    uploadingLabel,
    processingLabel,
    uploadProgress,
    durationLabel,
    briefPhaseLabel,
    reassuranceLabel,
    onCancel,
  }: EchoProcessingStepProps): React.ReactElement => {
    const { color } = useTheme();
    const [elapsedMs, setElapsedMs] = useState(0);
    const [briefPhaseElapsed, setBriefPhaseElapsed] = useState(0);

    useEffect(() => {
      const start = Date.now();
      const id = setInterval(() => setElapsedMs(Date.now() - start), 1_000);
      return (): void => clearInterval(id);
    }, []);

    useEffect(() => {
      if (!briefPhaseLabel) return;
      const start = Date.now();
      const id = setInterval(() => {
        const ms = Date.now() - start;
        if (ms >= BRIEF_PHASE_MS) {
          setBriefPhaseElapsed(ms);
          clearInterval(id);
        } else {
          setBriefPhaseElapsed(ms);
        }
      }, 400);
      return (): void => clearInterval(id);
    }, [briefPhaseLabel]);

    const determinate = uploadProgress != null;
    const percent = determinate ? Math.round(uploadProgress * 100) : 0;
    const inBriefPhase =
      !!briefPhaseLabel && !determinate && briefPhaseElapsed < BRIEF_PHASE_MS;
    const label = determinate
      ? uploadingLabel
      : inBriefPhase
        ? briefPhaseLabel
        : processingLabel;

    return (
      <Box
        style={{
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spinner size="lg" color={color.brand} />

        <Text variant="heading3" style={{ marginTop: spacing.md }}>
          {title}
        </Text>
        <Text
          variant="bodySmall"
          style={{ marginTop: spacing.xs, color: color.muted }}
        >
          {label}
        </Text>

        {durationLabel ? (
          <Box
            style={{
              marginTop: spacing.sm,
              paddingVertical: spacing.xs,
              paddingHorizontal: spacing.md,
              borderRadius: borderRadius["2xl"],
              backgroundColor: withAlpha(color.brand, 0.18),
            }}
          >
            <Text variant="caption" style={{ color: color.brand }}>
              {durationLabel}
            </Text>
          </Box>
        ) : null}

        <Box
          style={{
            width: "100%",
            paddingHorizontal: spacing.lg,
            marginTop: spacing.md,
          }}
        >
          {determinate ? (
            <DeterminateBar
              percent={percent}
              color={color.brand}
              trackColor={color.border}
            />
          ) : (
            <IndeterminateBar color={color.brand} trackColor={color.border} />
          )}

          <Box
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: spacing.sm,
            }}
          >
            <Text variant="caption" style={{ color: color.muted }}>
              {determinate ? "Uploading" : "Processing"}
            </Text>
            <Text variant="caption" style={{ color: color.muted }}>
              {determinate ? `${percent}%` : ""}
            </Text>
          </Box>

          <Text
            variant="bodySmall"
            accessibilityElementsHidden={elapsedMs < ELAPSED_REASSURE_MS}
            importantForAccessibility={
              elapsedMs < ELAPSED_REASSURE_MS
                ? "no-hide-descendants"
                : "auto"
            }
            style={{
              marginTop: spacing.sm,
              color: color.muted,
              textAlign: "center",
              opacity: elapsedMs >= ELAPSED_REASSURE_MS ? 1 : 0,
            }}
          >
            {reassuranceLabel ??
              "Taking longer than expected… still working."}
          </Text>
        </Box>

        {onCancel ? (
          <Pressable
            feedback="opacity"
            onPress={onCancel}
            accessibilityLabel="Cancel"
            style={{
              marginTop: spacing.lg,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.xl,
              borderRadius: borderRadius["2xl"],
              borderWidth: 1,
              borderColor: color.border,
            }}
          >
            <Text variant="bodySmall" style={{ color: color.muted }}>
              Cancel
            </Text>
          </Pressable>
        ) : null}
      </Box>
    );
  },
);

EchoProcessingStep.displayName = "EchoProcessingStep";

interface BarProps {
  color: string;
  trackColor: string;
}

function DeterminateBar({
  percent,
  color,
  trackColor,
}: BarProps & { percent: number }): React.ReactElement {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      accessibilityLabel="Upload progress"
      style={{
        width: "100%",
        height: 6,
        borderRadius: borderRadius.sm,
        backgroundColor: trackColor,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${percent}%`,
          height: "100%",
          borderRadius: borderRadius.sm,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function IndeterminateBar({
  color,
  trackColor,
}: BarProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  const trackWidth = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 1_200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const width = trackWidth.value;
    return {
      transform: [
        {
          translateX: interpolate(progress.value, [0, 1], [-0.3 * width, width]),
        },
      ],
    };
  });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Processing audio"
      style={{
        width: "100%",
        height: 6,
        borderRadius: borderRadius.sm,
        backgroundColor: trackColor,
        overflow: "hidden",
      }}
      onLayout={(e): void => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
    >
      {!reduceMotion && (
        <Animated.View
          style={[
            {
              width: "30%",
              height: "100%",
              borderRadius: borderRadius.sm,
              backgroundColor: color,
            },
            animatedStyle,
          ]}
        />
      )}
    </View>
  );
}
