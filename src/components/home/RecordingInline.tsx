import { Play, Pause } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Box, Text, Pressable } from '@/components/ui';
import { shadows } from '@/constants';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme, useSharedAudioPlayer } from '@/hooks';
import type { DictationStatus } from '@/hooks/useVoiceDictation';

const TOTAL_BARS = 35;

const getNormalizedWaveform = (
  data: number[],
  targetLength: number,
): number[] => {
  if (!data || data.length === 0) {
    // Generate beautiful dome shape
    return Array.from(
      { length: targetLength },
      (_, i) => 0.15 + Math.sin((i / (targetLength - 1)) * Math.PI) * 0.45,
    );
  }

  const resampled: number[] = [];
  let maxVal = 0.01;

  for (let i = 0; i < targetLength; i++) {
    const dataIndex = Math.floor((i / targetLength) * data.length);
    const val = Math.abs(data[dataIndex] || 0);
    if (val > maxVal) maxVal = val;
    resampled.push(val);
  }

  return resampled.map((v) => v / maxVal);
};

interface WaveBarProps {
  index: number;
  totalBars: number;
  amplitude: SharedValue<number>;
  phase: SharedValue<number>;
  isPreview: boolean;
  normalizedPeaks: number[];
  progressSV: SharedValue<number>;
  duration: number;
}

function WaveBar({
  index,
  totalBars,
  amplitude,
  phase,
  isPreview,
  normalizedPeaks,
  progressSV,
  duration,
}: WaveBarProps): React.ReactElement {
  const { color } = useTheme();

  const animStyle = useAnimatedStyle(() => {
    let targetHeight = 4;
    let isActive = false;

    if (isPreview) {
      const peak = normalizedPeaks[index] ?? 0.15;
      targetHeight = interpolate(peak, [0, 1], [4, 36]);

      if (duration > 0) {
        const playedFraction = progressSV.value / duration;
        isActive = index / totalBars <= playedFraction;
      }
    } else {
      // Live recording: strictly use true amplitude data so the user sees their voice.
      // Adding a tiny 5% noise just so it's not perfectly dead flat when silent.
      const baseJitter = Math.sin(phase.value + index * 0.5) * 0.05 + 0.05;
      const activeValue = Math.max(amplitude.value, baseJitter);
      targetHeight = interpolate(activeValue, [0, 1], [4, 36]);
    }

    const isInactivePreview = isPreview && !isActive;

    return {
      height: withTiming(targetHeight, { duration: 100 }),
      backgroundColor: isPreview
        ? isActive
          ? color.secondary
          : color.foreground
        : color.error,
      opacity: isInactivePreview ? 0.15 : 1,
    };
  });

  return <Animated.View style={[{ width: 3, borderRadius: 1.5 }, animStyle]} />;
}

function ProcessingBar({
  index,
  totalBars,
}: {
  index: number;
  totalBars: number;
}): React.ReactElement {
  const { color } = useTheme();
  const opacity = useSharedValue(1);

  useEffect(() => {
    const delay = index * 40;
    const timeout = setTimeout(() => {
      opacity.value = withRepeat(withTiming(0.2, { duration: 600 }), -1, true);
    }, delay);
    return (): void => clearTimeout(timeout);
  }, [index, opacity]);

  const animStyle = useAnimatedStyle(() => {
    const waveHeight = 8 + Math.sin((index / (totalBars - 1)) * Math.PI) * 20;
    return {
      opacity: opacity.value,
      height: withTiming(waveHeight, { duration: 200 }),
    };
  });

  return (
    <Animated.View
      style={[
        { width: 3, borderRadius: 1.5 },
        animStyle,
        { backgroundColor: color.muted },
      ]}
    />
  );
}

interface RecordingInlineProps {
  status: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  maxDurationMs: number;
  capturedUri: string | null;
  meteringData: number[];
}

export function RecordingInline({
  status,
  amplitude,
  elapsedMs,
  capturedUri,
  meteringData,
}: RecordingInlineProps): React.ReactElement {
  const { color } = useTheme();
  const isProcessing = status === 'processing';
  const isPreview = status === 'preview';

  const player = useSharedAudioPlayer(isPreview ? capturedUri : null);
  const isPlaying = player.isPlaying;

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const dotOpacity = useSharedValue(1);
  const phase = useSharedValue(0);

  useEffect(() => {
    if (status === 'recording') {
      dotOpacity.value = withRepeat(
        withTiming(0.2, { duration: 600 }),
        -1,
        true,
      );
      phase.value = withRepeat(
        withTiming(2 * Math.PI, { duration: 1500 }),
        -1,
        false,
      );
    } else if (status === 'preview' && isPlaying) {
      dotOpacity.value = 1;
      phase.value = withRepeat(
        withTiming(2 * Math.PI, { duration: 1500 }),
        -1,
        false,
      );
    } else {
      dotOpacity.value = 1;
      phase.value = 0;
    }
  }, [status, isPlaying, dotOpacity, phase]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  const normalizedPeaks = useMemo(() => {
    if (!isPreview) return [];
    const sourcePeaks =
      player.realWaveform.length > 0 ? player.realWaveform : meteringData;
    return getNormalizedWaveform(sourcePeaks, TOTAL_BARS);
  }, [isPreview, player.realWaveform, meteringData]);

  const bars = useMemo(() => {
    return Array.from({ length: TOTAL_BARS }).map((_, i) =>
      isProcessing ? (
        <ProcessingBar key={i} index={i} totalBars={TOTAL_BARS} />
      ) : (
        <WaveBar
          key={i}
          index={i}
          totalBars={TOTAL_BARS}
          amplitude={amplitude}
          phase={phase}
          isPreview={isPreview}
          normalizedPeaks={normalizedPeaks}
          progressSV={player.progressSV}
          duration={player.duration}
        />
      ),
    );
  }, [
    isProcessing,
    isPreview,
    amplitude,
    phase,
    normalizedPeaks,
    player.progressSV,
    player.duration,
  ]);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 72,
        borderRadius: borderRadius['2xl'],
        paddingHorizontal: spacing.md,
        backgroundColor: color.surface,
      }}
    >
      {isPreview ? (
        <Box
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.sm,
          }}
        >
          <Pressable
            onPress={() => (player.isPlaying ? player.pause() : player.play())}
            style={{
              width: 48,
              height: 48,
              borderRadius: borderRadius['2xl'],
              alignItems: 'center',
              justifyContent: 'center',
              ...shadows.soft,
              backgroundColor: color.secondary,
            }}
            accessibilityLabel={
              player.isPlaying ? 'Pause playback' : 'Play recording'
            }
          >
            {player.isPlaying ? (
              <Pause
                size={22}
                color={color.onSecondary}
                fill={color.onSecondary}
              />
            ) : (
              <Play
                size={22}
                color={color.onSecondary}
                fill={color.onSecondary}
              />
            )}
          </Pressable>
          <Box
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 40,
              marginLeft: spacing.md,
            }}
          >
            {bars}
          </Box>
        </Box>
      ) : (
        <Box
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.sm,
          }}
        >
          <Box
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <Animated.View
              style={[
                { width: 8, height: 8, borderRadius: borderRadius.sm },
                dotStyle,
                { backgroundColor: color.error },
              ]}
            />
            <Text variant="body" style={{ color: color.foreground }}>
              {formatTime(elapsedMs)}
            </Text>
          </Box>
          {isProcessing ? (
            <Text variant="bodySmall" style={{ color: color.muted }}>
              Transcribing...
            </Text>
          ) : (
            <Box
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: 40,
                marginLeft: spacing.md,
              }}
            >
              {bars}
            </Box>
          )}
        </Box>
      )}
    </Animated.View>
  );
}
