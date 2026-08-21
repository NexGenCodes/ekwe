import Play from "lucide-react-native/icons/play";
import Pause from "lucide-react-native/icons/pause";
import Zap from "lucide-react-native/icons/zap";
import React, { useCallback, useState } from "react";
import { SharedValue } from "react-native-reanimated";

import { AudioWaveform as ReanimatedWaveform } from "../../AudioWaveform";

import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { borderRadius, touchTarget, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";
import { withAlpha } from "@/utils/color";
import { SharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { PLAYBACK_RATES } from "@/hooks/audio/useSharedAudioPlayer";
import { formatDuration } from "@/utils/formatDuration";

export interface EchoPreviewStepProps {
  player: SharedAudioPlayer;
  isResolving: boolean;
  peaks: number[];
  onTranscribe: (duration: number, waveform: number[]) => void;
  children: React.ReactNode;
}

interface PlaybackControlProps {
  isPlaying: boolean;
  isDecoding: boolean;
  isLoaded: boolean;
  disabled: boolean;
  progress: number;
  progressSV: SharedValue<number>;
  duration: number;
  peaks: number[];
  playbackRate: number;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onScrubStateChange?: (isScrubbing: boolean) => void;
}

/**
 * A WhatsApp-style audio control bar. The play button, waveform and speed pill
 * (1x/1.5x/2x) share a single centered row so they align with each other; the
 * elapsed/total timer sits directly beneath the waveform. All controls are
 * disabled until the audio is loaded.
 */
const PlaybackControl: React.FC<PlaybackControlProps> = React.memo(
  function PlaybackControl({
    isPlaying,
    isDecoding,
    isLoaded,
    disabled,
    progress,
    progressSV,
    duration,
    peaks,
    playbackRate,
    onTogglePlay,
    onSeek,
    onPlaybackRateChange,
    onScrubStateChange,
  }: PlaybackControlProps) {
    const [scrubTime, setScrubTime] = useState<number | null>(null);

    const { color } = useTheme();

    const handleSeeking = useCallback(
      (normalizedProgress: number): void => {
        const nextTime = normalizedProgress * duration;
        setScrubTime((prev) => {
          if (prev !== null && Math.floor(prev) === Math.floor(nextTime)) {
            return prev;
          }
          return nextTime;
        });
      },
      [duration],
    );

    const handleSeek = useCallback(
      (normalizedProgress: number): void => {
        setScrubTime(null);
        onSeek(normalizedProgress * duration);
      },
      [onSeek, duration],
    );

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
        <Box style={{ padding: spacing.md }}>
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
            }}
          >
            <Pressable
              feedback="opacity"
              onPress={onTogglePlay}
              disabled={disabled}
              accessibilityLabel={isPlaying ? "Pause audio" : "Play audio"}
              accessibilityState={{ disabled }}
              style={{
                width: 48,
                height: 48,
                borderRadius: borderRadius["2xl"],
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: color.brand,
                opacity: disabled ? opacity.disabled : 1,
              }}
            >
              {isDecoding || !isLoaded ? (
                <Spinner size="sm" color={color.onBrand} />
              ) : isPlaying ? (
                <Pause size={18} color={color.onBrand} fill={color.onBrand} />
              ) : (
                <Play size={18} color={color.onBrand} fill={color.onBrand} />
              )}
            </Pressable>

            <Box style={{ flex: 1, height: 48, justifyContent: "center" }}>
              <ReanimatedWaveform
                amplitudes={peaks}
                progressSV={progressSV}
                duration={duration}
                interactive={!disabled}
                onSeeking={handleSeeking}
                onSeek={handleSeek}
                onScrubStateChange={onScrubStateChange}
              />
            </Box>

            <Pressable
              feedback="opacity"
              onPress={() => {
                const idx = PLAYBACK_RATES.indexOf(
                  playbackRate as (typeof PLAYBACK_RATES)[number],
                );
                const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
                onPlaybackRateChange(next);
              }}
              disabled={disabled}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Playback speed ${playbackRate}x`}
              accessibilityState={{ disabled }}
              style={{
                height: touchTarget.minimum,
                minWidth: touchTarget.minimum,
                paddingHorizontal: spacing.sm,
                borderRadius: borderRadius.full,
                backgroundColor: withAlpha(color.brand, 0.14),
                alignItems: "center",
                justifyContent: "center",
                opacity: disabled ? opacity.disabled : 1,
              }}
            >
              <Text
                variant="caption"
                style={{
                  color: playbackRate > 1 ? color.brand : color.muted,
                  fontWeight: "600",
                }}
              >
                {playbackRate}x
              </Text>
            </Pressable>
          </Box>

          <Box
            style={{
              marginTop: spacing.xs,
              paddingLeft: 48 + spacing.md,
              alignItems: "center",
              flexDirection: "row",
            }}
          >
            <Text variant="caption" style={{ color: color.muted }}>
              {formatDuration(scrubTime !== null ? scrubTime : progress) ??
                "0:00"}{" "}
              / {formatDuration(duration) ?? "0:00"}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  },
);

export const EchoPreviewStep: React.FC<EchoPreviewStepProps> = React.memo(
  ({ player, isResolving, peaks, onTranscribe, children }) => {
    const { color } = useTheme();
    const ready = player.isLoaded && !isResolving && !player.isDecoding;

    const handleTogglePlay = useCallback((): void => {
      if (player.isPlaying) {
        player.pause();
      } else {
        void player.play();
      }
    }, [player]);

    const handleSeek = useCallback(
      (seconds: number): void => {
        void player.endScrub(seconds);
      },
      [player],
    );

    const handleScrubStateChange = useCallback(
      (isScrubbing: boolean): void => {
        if (isScrubbing) player.beginScrub();
      },
      [player],
    );

    const handleTranscribe = useCallback((): void => {
      onTranscribe(player.duration, peaks);
    }, [onTranscribe, player.duration, peaks]);

    return (
      <Box>
        <PlaybackControl
          isPlaying={player.isPlaying}
          isDecoding={player.isDecoding || isResolving}
          isLoaded={player.isLoaded}
          disabled={!ready}
          progress={player.progress}
          progressSV={player.progressSV}
          duration={player.duration}
          peaks={peaks}
          playbackRate={player.playbackRate}
          onTogglePlay={handleTogglePlay}
          // The scrub lifecycle lives in the player: `beginScrub` captures
          // whether audio was actively playing, `endScrub` seeks and resumes
          // only if it was. A finished/paused track stays paused.
          onSeek={handleSeek}
          onPlaybackRateChange={player.setPlaybackRate}
          onScrubStateChange={handleScrubStateChange}
        />

        {children}

        <Pressable
          feedback="opacity"
          onPress={handleTranscribe}
          disabled={!ready}
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: spacing.sm,
            paddingVertical: spacing.md,
            borderRadius: borderRadius["2xl"],
            backgroundColor: color.brand,
            opacity: ready ? 1 : opacity.disabled,
          }}
        >
          {!ready && (
            <Spinner
              size="sm"
              color={color.onBrand}
              style={{ marginRight: spacing.sm }}
            />
          )}
          <Zap size={18} color={color.onBrand} fill={color.onBrand} />
          <Text variant="body" style={{ color: color.onBrand }}>
            {!ready ? "Loading Audio…" : "Transcribe"}
          </Text>
        </Pressable>
      </Box>
    );
  },
);
