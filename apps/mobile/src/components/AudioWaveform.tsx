import React, { useEffect, useMemo } from "react";
import { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
  useAnimatedReaction,
  runOnJS,
} from "react-native-reanimated";

import { Box } from "@/components/ui";
import { opacity } from "@/constants/sizes";
import { useTheme } from "@/hooks";

const DEFAULT_BAR_COUNT = 40;
const DEFAULT_BAR_W = 4;
const DEFAULT_BAR_GAP = 2;
const DEFAULT_MIN_H = 2;
const DEFAULT_RANGE = 36;

export interface AudioWaveformProps {
  amplitudes: number[] | SharedValue<number[]>;
  progressSV?: SharedValue<number>;
  duration?: number;
  barCount?: number;
  height?: number;
  barWidth?: number;
  barGap?: number;
  minBarHeight?: number;
  activeColor?: string;
  inactiveColor?: string;
  interactive?: boolean;
  onSeek?: (progress: number) => void;
  onSeeking?: (progress: number) => void;
  onScrubStateChange?: (isScrubbing: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

interface BarItemProps {
  index: number;
  barHeights: SharedValue<number[]>;
  measuredWidth: SharedValue<number>;
  progressSV?: SharedValue<number>;
  duration: number;
  barCount: number;
  canvasHeight: number;
  barWidth: number;
  barGap: number;
  minBarHeight: number;
  activeColor: string;
  inactiveColor: string;
}

// Each bar is a memoized leaf: its props (shared values + primitives) stay
// referentially stable across parent renders, so the 40 children never
// re-render. All per-update math runs in a UI-thread worklet, so bar
// height/width/color changes never round-trip through the JS bridge.
//
// Bars use the Skia layout model: every bar is absolutely positioned at
// x = index * step (step = measuredWidth / barCount) so the strip spans the
// full container width. This keeps the drawn bars, the seek thumb, and the
// drag hit-target in the exact same coordinate space — progress = x / width
// always lands on the visible bar underneath the finger.
const BarItem = React.memo(function BarItem({
  index,
  barHeights,
  measuredWidth,
  progressSV,
  duration,
  barCount,
  canvasHeight,
  barWidth,
  barGap,
  minBarHeight,
  activeColor,
  inactiveColor,
}: BarItemProps) {
  const style = useAnimatedStyle(() => {
    const h = Math.max(minBarHeight, barHeights.value[index] ?? minBarHeight);
    const step = Math.max(minBarHeight, measuredWidth.value / barCount);
    const w = Math.max(minBarHeight, Math.min(barWidth, step - barGap));
    const y = Math.max(0, (canvasHeight - h) / 2);
    const dur = duration > 0 ? duration : 1;
    const frac = progressSV ? progressSV.value / dur : 1;
    const color = index / barCount <= frac ? activeColor : inactiveColor;
    return {
      position: "absolute",
      left: index * step,
      top: y,
      width: w,
      height: h,
      borderRadius: w / 2,
      backgroundColor: color,
    };
  });

  return <Animated.View style={style} />;
});

export function AudioWaveform({
  amplitudes,
  progressSV,
  duration,
  barCount = DEFAULT_BAR_COUNT,
  height = 40,
  barWidth = DEFAULT_BAR_W,
  barGap = DEFAULT_BAR_GAP,
  minBarHeight = DEFAULT_MIN_H,
  activeColor,
  inactiveColor,
  interactive = true,
  onSeek,
  onSeeking,
  onScrubStateChange,
  style,
}: AudioWaveformProps): React.ReactElement {
  const { color } = useTheme();

  const finalActiveColor = activeColor ?? color.brand;
  const finalInactiveColor = inactiveColor ?? color.foreground;

  const isSharedValue = amplitudes && "value" in amplitudes;
  const localAmplitudes = useSharedValue<number[]>(
    isSharedValue ? [] : (amplitudes as number[]),
  );

  useEffect(() => {
    if (!isSharedValue) {
      localAmplitudes.value = (amplitudes as number[]) || [];
    }
  }, [amplitudes, isSharedValue, localAmplitudes]);

  const targetAmplitudes = isSharedValue
    ? (amplitudes as SharedValue<number[]>)
    : localAmplitudes;

  const barHeights = useSharedValue<number[]>(
    new Array(barCount).fill(minBarHeight),
  );
  const measuredWidth = useSharedValue(200);

  useAnimatedReaction(
    () => targetAmplitudes.value,
    (amps) => {
      if (!amps || amps.length === 0) return;

      const arr = new Array(barCount);
      const sourceCount = amps.length;

      // Map every source bin evenly onto the visible bars. Using
      // floor(i*n/m)..floor((i+1)*n/m) guarantees all bins are represented,
      // unlike a fixed `chunk` stride which drops trailing bins when the
      // source count isn't a multiple of barCount.
      for (let i = 0; i < barCount; i++) {
        const start = Math.floor((i * sourceCount) / barCount);
        const end = Math.max(
          start + 1,
          Math.floor(((i + 1) * sourceCount) / barCount),
        );

        let raw = 0;
        for (let j = start; j < end && j < sourceCount; j++) {
          const v = amps[j] ?? 0;
          if (v > raw) raw = v;
        }

        const n = Math.min(1, Math.max(0, raw));
        arr[i] = minBarHeight + Math.pow(n, 0.5) * DEFAULT_RANGE;
      }
      barHeights.value = arr;
    },
    [targetAmplitudes, barCount, minBarHeight],
  );

  const handleLayout = (event: LayoutChangeEvent): void => {
    measuredWidth.value = event.nativeEvent.layout.width;
  };

  // The gesture objects must keep a stable identity: GestureDetector re-attaches
  // when its `gesture` prop identity changes, so rebuilding these each render
  // (as would happen from a fast parent like PlaybackControl) churns the native
  // gesture handler. Anchoring the composition on the values the handlers
  // capture keeps it stable across renders.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(interactive)
        .onBegin(() => {
          if (onScrubStateChange) runOnJS(onScrubStateChange)(true);
        })
        .onUpdate((event) => {
          const progress = Math.max(
            0,
            Math.min(1, event.x / measuredWidth.value),
          );
          if (progressSV && duration) {
            progressSV.value = progress * duration;
          }
          if (onSeeking) {
            runOnJS(onSeeking)(progress);
          }
        })
        .onEnd((event) => {
          if (onScrubStateChange) runOnJS(onScrubStateChange)(false);
          if (onSeek) {
            const progress = Math.max(
              0,
              Math.min(1, event.x / measuredWidth.value),
            );
            runOnJS(onSeek)(progress);
          }
        })
        .onFinalize(() => {
          if (onScrubStateChange) runOnJS(onScrubStateChange)(false);
        }),
    [
      interactive,
      onScrubStateChange,
      measuredWidth,
      progressSV,
      duration,
      onSeeking,
      onSeek,
    ],
  );

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(interactive)
        .onBegin(() => {
          if (onScrubStateChange) runOnJS(onScrubStateChange)(true);
        })
        .onEnd((event) => {
          if (onScrubStateChange) runOnJS(onScrubStateChange)(false);
          if (onSeek) {
            const progress = Math.max(
              0,
              Math.min(1, event.x / measuredWidth.value),
            );
            runOnJS(onSeek)(progress);
          }
        })
        .onFinalize(() => {
          if (onScrubStateChange) runOnJS(onScrubStateChange)(false);
        }),
    // `measuredWidth` is a useSharedValue: the object is stable across renders
    // and `.value` is read inside the gesture callback, not during render.
    [interactive, onScrubStateChange, measuredWidth, onSeek],
  );

  const composed = useMemo(
    () => Gesture.Exclusive(gesture, tap),
    [gesture, tap],
  );

  const bars = useMemo(() => {
    const result: number[] = [];
    for (let i = 0; i < barCount; i++) {
      result.push(i);
    }
    return result;
  }, [barCount]);

  if (
    !isSharedValue &&
    (!amplitudes || (amplitudes as number[]).length === 0)
  ) {
    return (
      <Box style={[{ height, flex: 1, justifyContent: "center" }, style]}>
        <Box
          style={{
            height: 2,
            borderRadius: 1,
            opacity: opacity.disabled,
            backgroundColor: color.muted,
          }}
        />
      </Box>
    );
  }

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[{ height, flex: 1 }, style]}
        onLayout={handleLayout}
      >
        <Animated.View
          style={{
            flex: 1,
            position: "relative",
          }}
        >
          {bars.map((i) => (
            <BarItem
              key={i}
              index={i}
              barHeights={barHeights}
              measuredWidth={measuredWidth}
              progressSV={progressSV}
              duration={duration ?? 1}
              barCount={barCount}
              canvasHeight={height}
              barWidth={barWidth}
              barGap={barGap}
              minBarHeight={minBarHeight}
              activeColor={finalActiveColor}
              inactiveColor={finalInactiveColor}
            />
          ))}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
