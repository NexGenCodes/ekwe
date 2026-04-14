import { Canvas, Rect, Skia, Mask, Path } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { getColor } from '@/constants/colors';

interface SkiaWaveformProps {
  peaks: number[]; // 50 normalized peaks [0, 1]
  progress: number; // Current playback time
  duration: number; // Total duration
  height?: number;
  isDark?: boolean;
  onScrub?: (time: number) => void;
  onSeek?: (time: number) => void;
}

/**
 * SkiaWaveform
 *
 * High-performance audio waveform rendered via Canvas.
 * Uses a progress mask to highlight played segments with the brand primary color.
 */
export const SkiaWaveform: React.FC<SkiaWaveformProps> = ({
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

  // Normalized progress (0 to 1)
  const normalizedProgress = duration > 0 ? progress / duration : 0;

  // Compute the path once for the waveform
  const waveformPath = useMemo(() => {
    const p = Skia.Path.Make();
    const barWidth = 4;
    const gap = 2;

    peaks.forEach((peak, i) => {
      const x = i * (barWidth + gap);
      const barHeight = Math.max(2, peak * height);
      const y = (height - barHeight) / 2;

      p.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, barWidth, barHeight), 2, 2));
    });

    return p;
  }, [peaks, height]);

  const containerWidth = (peaks.length || 50) * 6;

  const handleInteraction = (x: number, isEnd: boolean): void => {
    const clampedX = Math.max(0, Math.min(x, containerWidth));
    const p = (clampedX / containerWidth) * duration;
    if (isEnd) {
      if (onSeek) onSeek(p);
    } else {
      if (onScrub) onScrub(p);
    }
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          runOnJS(handleInteraction)(e.x, false);
        })
        .onUpdate((e) => {
          runOnJS(handleInteraction)(e.x, false);
        })
        .onEnd((e) => {
          runOnJS(handleInteraction)(e.x, true);
        }),
    [containerWidth, duration, onScrub, onSeek],
  );

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ height, width: containerWidth }}>
        <Canvas style={{ flex: 1, pointerEvents: 'none' }}>
          {/* Background / Unplayed Waveform */}
          <Path path={waveformPath} color={mutedColor} opacity={0.3} />

          {/* Progress Mask Overlay */}
          <Mask
            mask={
              <Rect
                x={0}
                y={0}
                width={containerWidth * normalizedProgress}
                height={height}
              />
            }
          >
            <Path path={waveformPath} color={primaryColor} />
          </Mask>
        </Canvas>
      </View>
    </GestureDetector>
  );
};
