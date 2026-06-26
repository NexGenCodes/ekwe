import { useSelector } from "@legendapp/state/react";
import { Mic } from "lucide-react-native";
import React, { useEffect, useMemo } from "react";
import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { Text } from "@/components/ui";
import { bubbleColors } from "@/constants/colors";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useMetering, useTheme } from "@/hooks";
import { audio$, audioActions, settings$, RecordingState } from "@/store";

// Live Activity management — expo-widgets
const updateLiveActivity = (_state: RecordingState): void => {
  // Logic placeholder for Live Activity
};

export function LensBubble(): React.ReactElement | null {
  const { isDark, color } = useTheme();
  const bubbleTheme = bubbleColors(isDark);
  const recordingState = useSelector(() => audio$.recordingState.get());
  const bubbleEnabled = useSelector(() => settings$.bubbleEnabled.get());
  const { resetAudioState } = audioActions;

  const liveAmplitude = useMetering();

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          recordingState === RecordingState.Recording
            ? withSpring(1 + liveAmplitude.value * 0.15, {
                damping: 12,
                stiffness: 300,
                mass: 0.3,
              })
            : withSpring(1),
      },
    ],
  }));

  // Sync state to Live Activity
  useEffect(() => {
    updateLiveActivity(recordingState);
  }, [recordingState]);

  // Auto-reset timers
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (recordingState === RecordingState.Done) {
      timer = setTimeout(() => resetAudioState(), 3000);
    } else if (recordingState === RecordingState.Error) {
      timer = setTimeout(() => resetAudioState(), 5000);
    }
    return (): void => { if (timer) clearTimeout(timer); };
  }, [recordingState, resetAudioState]);

  // THEME COLORS
  const onPrimaryColor = color.onBrand;
  const stateColor = useMemo(() => {
    switch (recordingState) {
      case RecordingState.Recording:
        return bubbleTheme.recording;
      case RecordingState.Processing:
        return bubbleTheme.processing;
      case RecordingState.Done:
        return bubbleTheme.done;
      case RecordingState.Error:
        return bubbleTheme.error;
      default:
        return bubbleTheme.idle;
    }
  }, [recordingState, bubbleTheme]);

  const stateLabel = useMemo(() => {
    switch (recordingState) {
      case RecordingState.Recording:
        return "Recording";
      case RecordingState.Processing:
        return "Processing";
      case RecordingState.Done:
        return "Done";
      case RecordingState.Error:
        return "Error";
      default:
        return "Ekwe ready";
    }
  }, [recordingState]);

  if (!bubbleEnabled) return null;

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: spacing["5xl"],
          alignSelf: "center",
          borderRadius: borderRadius.full,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        { backgroundColor: stateColor },
        pillAnimatedStyle,
      ]}
    >
      <Mic size={14} color={onPrimaryColor} />
      <Text
        variant="caption"
        style={{
          textTransform: "uppercase",
          color: onPrimaryColor,
        }}
      >
        {stateLabel}
      </Text>
    </Animated.View>
  );
}
