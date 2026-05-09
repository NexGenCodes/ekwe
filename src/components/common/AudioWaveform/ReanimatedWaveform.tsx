import * as Haptics from 'expo-haptics';
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, runOnJS } from 'react-native-reanimated';

import { getColor } from '@/constants/colors';

interface ReanimatedWaveformProps {
  peaks: number[]; // 50 normalized peaks [0, 1]
  progress: number; // Current playback time
  duration: number; // Total duration
  height?: number;
  isDark?: boolean;
  onScrub?: (time: number) => void;
  onSeek?: (time: number) => void;
}

/**
 * ReanimatedWaveform
 *
 * High-performance audio waveform rendered via Reanimated and native views.
 * Uses an Animated width wrapper to simulate a fill mask, avoiding heavy Graphics APIs.
 */
export const ReanimatedWaveform: React.FC<ReanimatedWaveformProps> = ({
  peaks,
  progress,
  duration,
  height = 40,
  isDark = false,
  onScrub,
  onSeek,
}) => {
  const primaryColor = getColor('primary', isDark);
  const mutedColor = getColor('muted', isDark);

  const barWidth = 4;
  const gap = 2;
  const numPeaks = peaks.length || 50;
  const containerWidth = numPeaks * (barWidth + gap);

  // Normalized progress (0 to 1)
  const normalizedProgress = duration > 0 ? progress / duration : 0;

  const handleInteraction = (x: number, isEnd: boolean): void => {
    const clampedX = Math.max(0, Math.min(x, containerWidth));
    const p = (clampedX / containerWidth) * duration;
    if (isEnd) {
      if (onSeek) onSeek(p);
    } else {
      if (onScrub) onScrub(p);
    }
  };

  const handleBegin = (x: number): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleInteraction(x, false);
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .hitSlop({ top: 24, bottom: 24 })
        .onBegin((e) => {
          runOnJS(handleBegin)(e.x);
        })
        .onUpdate((e) => {
          runOnJS(handleInteraction)(e.x, false);
        })
        .onEnd((e) => {
          runOnJS(handleInteraction)(e.x, true);
        }),
    [containerWidth, duration, onScrub, onSeek],
  );

  const activeWidthStyle = useAnimatedStyle(() => {
    return {
      width: containerWidth * normalizedProgress,
    };
  });

  const renderBars = (color: string): React.ReactElement => (
    <View style={[styles.barsContainer, { width: containerWidth }]}>
      {peaks.map((peak, i) => {
        const barHeight = Math.max(2, peak * height);
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                width: barWidth,
                height: barHeight,
                marginRight: gap,
                backgroundColor: color,
              },
            ]}
          />
        );
      })}
    </View>
  );

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ height, width: containerWidth, justifyContent: 'center' }}>
        {/* Background / Unplayed Waveform */}
        <View style={[StyleSheet.absoluteFill, { opacity: 0.3 }]}>
          {renderBars(mutedColor)}
        </View>

        {/* Progress Mask Overlay */}
        <Animated.View style={[styles.activeContainer, activeWidthStyle]}>
          {renderBars(primaryColor)}
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  bar: {
    borderRadius: 2,
  },
  activeContainer: {
    overflow: 'hidden',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
});
