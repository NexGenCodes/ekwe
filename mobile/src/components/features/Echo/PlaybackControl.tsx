import { Play, Pause } from "lucide-react-native";
import React, { useState } from "react";
import { SharedValue } from "react-native-reanimated";

import { AudioWaveform as ReanimatedWaveform } from "../../AudioWaveform";

import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { formatDuration } from "@/utils/echo";

interface PlaybackControlProps {
  isPlaying: boolean;
  isDecoding: boolean;
  progress: number;
  progressSV: SharedValue<number>;
  duration: number;
  peaks: number[];
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
}

/**
 * PlaybackControl
 *
 * A reusable audio control bar with play/pause, waveform, and time tracking.
 */
export const PlaybackControl: React.FC<PlaybackControlProps> = ({
  isPlaying,
  isDecoding,
  progress,
  progressSV,
  duration,
  peaks,
  onTogglePlay,
  onSeek,
}) => {
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const { color } = useTheme();

  return (
    <Box
      style={{
        borderRadius: borderRadius["2xl"],
        borderWidth: 1,
        overflow: "hidden",
        marginBottom: spacing.lg,
        backgroundColor: color.background,
        borderColor: color.border,
      }}
    >
      <Box
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: spacing.md,
          gap: spacing.md,
        }}
      >
        <Pressable
          feedback="opacity"
          onPress={onTogglePlay}
          disabled={isDecoding}
          style={{
            width: 48,
            height: 48,
            borderRadius: borderRadius["2xl"],
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color.secondary,
            opacity: isDecoding ? opacity.disabled : 1,
          }}
        >
          {isDecoding ? (
            <Spinner size="sm" color={color.onSecondary} />
          ) : isPlaying ? (
            <Pause
              size={18}
              color={color.onSecondary}
              fill={color.onSecondary}
            />
          ) : (
            <Play
              size={18}
              color={color.onSecondary}
              fill={color.onSecondary}
            />
          )}
        </Pressable>

        <Box style={{ flex: 1, height: 48, justifyContent: "center" }}>
          <ReanimatedWaveform
            amplitudes={peaks}
            progressSV={progressSV}
            duration={duration}
            onSeeking={(normalizedProgress) => {
              setScrubTime(normalizedProgress * duration);
            }}
            onSeek={(normalizedProgress) => {
              const targetTime = normalizedProgress * duration;
              setScrubTime(null);
              onSeek(targetTime);
            }}
          />
        </Box>

        <Text
          variant="caption"
          style={{ width: 50, textAlign: "right", color: color.secondary }}
        >
          {formatDuration(scrubTime !== null ? scrubTime : progress)}
        </Text>
      </Box>
    </Box>
  );
};
