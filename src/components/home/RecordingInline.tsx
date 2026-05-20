import { Square, Trash2, Play, Pause, Send } from 'lucide-react-native';
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

import { useTheme, useSharedAudioPlayer } from '@/hooks';
import type { DictationStatus } from '@/hooks/useVoiceDictation';

const NUM_BARS = 7;

// Centre bar is tallest, outer bars are shorter — creates a natural wave shape.
const BAR_SCALES = [0.5, 0.7, 0.85, 1.0, 0.85, 0.7, 0.5];
// Outer bars animate slower, creating a ripple/wave lag effect.
const BAR_DURATIONS = [140, 120, 80, 50, 80, 120, 140];

/**
 * Individual waveform bar. Reads the shared amplitude directly in
 * useAnimatedStyle — the simplest and most reliable Reanimated pattern.
 * Per-bar scale + timing duration create a ripple wave effect.
 */
function WaveBar({
  amplitude,
  index,
}: {
  amplitude: SharedValue<number>;
  index: number;
}): React.ReactElement {
  const { color } = useTheme();
  const scale = BAR_SCALES[index];
  const duration = BAR_DURATIONS[index];

  const animStyle = useAnimatedStyle(() => {
    // Scale amplitude per bar — centre bar gets full value, edges get less
    const targetHeight = interpolate(amplitude.value * scale, [0, 1], [4, 36]);
    // withTiming inside useAnimatedStyle: standard Reanimated pattern.
    // Different durations per bar create the wave ripple.
    return { height: withTiming(targetHeight, { duration }) };
  });

  return (
    <Animated.View
      style={[styles.bar, animStyle, { backgroundColor: color.secondary }]}
    />
  );
}

function ProcessingBar({ index }: { index: number }): React.ReactElement {
  const { color } = useTheme();
  const opacity = useSharedValue(1);

  useEffect(() => {
    const delay = index * 80;
    const timeout = setTimeout(() => {
      opacity.value = withRepeat(withTiming(0.3, { duration: 500 }), -1, true);
    }, delay);
    return (): void => clearTimeout(timeout);
  }, [index, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    height: 20 + (index % 3) * 6,
  }));

  return (
    <Animated.View
      style={[styles.bar, animStyle, { backgroundColor: color.secondary }]}
    />
  );
}

interface RecordingInlineProps {
  status: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  maxDurationMs: number;
  onStop: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  capturedUri: string | null;
}

export function RecordingInline({
  status,
  amplitude,
  elapsedMs,
  maxDurationMs,
  onStop,
  onCancel,
  onConfirm,
  capturedUri,
}: RecordingInlineProps): React.ReactElement {
  const { color } = useTheme();
  const isProcessing = status === 'processing';
  const isPreview = status === 'preview';

  // Audio player for the preview phase
  const player = useSharedAudioPlayer(isPreview ? capturedUri : null);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const fillRatio = Math.min(elapsedMs / maxDurationMs, 1);

  // Memoize bars array to avoid re-creating on every render
  const bars = useMemo(
    () =>
      BAR_SCALES.map((_, i) =>
        isProcessing ? (
          <ProcessingBar key={i} index={i} />
        ) : (
          <WaveBar key={i} amplitude={amplitude} index={i} />
        ),
      ),
    [isProcessing, amplitude],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.container, { backgroundColor: color.surface }]}
    >
      <View style={styles.left}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.discardBtn,
            { backgroundColor: color.surface },
            pressed && { transform: [{ scale: 0.95 }] },
          ]}
          hitSlop={{ top: 2, bottom: 2 }}
          accessibilityRole="button"
          accessibilityLabel="Discard recording"
        >
          <Text
            style={{
              color: '#EF4444',
              fontFamily: 'Outfit-Medium',
              fontSize: 14,
            }}
          >
            Cancel
          </Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        {isPreview ? (
          <Pressable
            onPress={() => (player.isPlaying ? player.pause() : player.play())}
            style={[styles.playBtn, { backgroundColor: color.surface }]}
            accessibilityRole="button"
            accessibilityLabel={player.isPlaying ? 'Pause playback' : 'Play recording'}
          >
            {player.isPlaying ? (
              <Pause size={22} color={color.primary} fill={color.primary} />
            ) : (
              <Play size={22} color={color.primary} fill={color.primary} />
            )}
          </Pressable>
        ) : (
          <View style={styles.waveform}>{bars}</View>
        )}
        {isProcessing && (
          <Text style={[styles.processingText, { color: color.muted }]}>
            Transcribing...
          </Text>
        )}
      </View>

      <View style={styles.right}>
        {isPreview ? (
          <Pressable
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: color.primary },
              pressed && { transform: [{ scale: 0.9 }] },
            ]}
            hitSlop={{ top: 2, bottom: 2 }}
            accessibilityRole="button"
            accessibilityLabel="Use recording for transcription"
          >
            <Text
              style={{
                color: color.onPrimary,
                fontFamily: 'Outfit-Medium',
                fontSize: 14,
              }}
            >
              Use
            </Text>
          </Pressable>
        ) : (
          <>
            <Text style={[styles.timer, { color: color.foreground }]}>
              {formatTime(elapsedMs)}
            </Text>

            <Pressable
              onPress={onStop}
              disabled={isProcessing}
              style={({ pressed }) => [
                styles.stopBtn,
                { backgroundColor: color.primary },
                isProcessing && { opacity: 0.5 },
                pressed && !isProcessing && { transform: [{ scale: 0.9 }] },
              ]}
              hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
              accessibilityRole="button"
              accessibilityLabel="Stop recording"
            >
              <Square
                size={16}
                color={color.onPrimary}
                fill={color.onPrimary}
              />
            </Pressable>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 72,
    borderRadius: 36,
    paddingHorizontal: 16,
    marginHorizontal: 12,
  },
  left: {
    width: 90,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  discardBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.1)',
  },
  timer: {
    fontFamily: 'Outfit-Medium',
    fontSize: 14,
    width: 40,
    textAlign: 'right',
  },
  center: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 40,
  },
  bar: {
    width: 4,
    borderRadius: 2,
  },
  processingText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 90,
    justifyContent: 'flex-end',
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
});
