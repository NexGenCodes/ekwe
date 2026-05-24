import { Play, Pause } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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

import { borderRadius, spacing, typography } from '@/constants/designTokens';
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
          ? color.primary
          : color.foreground
        : '#EF4444',
      opacity: isInactivePreview ? 0.15 : 1,
    };
  });

  return <Animated.View style={[styles.bar, animStyle]} />;
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
      style={[styles.bar, animStyle, { backgroundColor: color.muted }]}
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
      style={[styles.container, { backgroundColor: color.surface }]}
    >
      {isPreview ? (
        <View style={styles.previewContainer}>
          <Pressable
            onPress={() => (player.isPlaying ? player.pause() : player.play())}
            style={[styles.playBtn, { backgroundColor: color.primary }]}
            accessibilityRole="button"
            accessibilityLabel={
              player.isPlaying ? 'Pause playback' : 'Play recording'
            }
          >
            {player.isPlaying ? (
              <Pause size={22} color={color.onPrimary} fill={color.onPrimary} />
            ) : (
              <Play size={22} color={color.onPrimary} fill={color.onPrimary} />
            )}
          </Pressable>
          <View style={styles.waveform}>{bars}</View>
        </View>
      ) : (
        <View style={styles.recordingContainer}>
          <View style={styles.timerContainer}>
            <Animated.View
              style={[styles.dot, dotStyle, { backgroundColor: '#EF4444' }]}
            />
            <Text style={[styles.timer, { color: color.foreground }]}>
              {formatTime(elapsedMs)}
            </Text>
          </View>
          {isProcessing ? (
            <Text style={[styles.processingText, { color: color.muted }]}>
              Transcribing...
            </Text>
          ) : (
            <View style={styles.waveform}>{bars}</View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 72,
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing[4],
  },
  previewContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
  },
  recordingContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timer: {
    fontFamily: 'Outfit-Medium',
    fontSize: typography.body.size,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
  processingText: {
    fontFamily: 'Outfit-Medium',
    fontSize: typography.bodySmall.size,
    letterSpacing: 0.3,
  },
});
