import React, { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
  useAnimatedReaction,
  runOnJS,
  withTiming,
} from "react-native-reanimated";

import { Box } from "@/components/ui";
import { opacity } from "@/constants/sizes";
import { useTheme } from "@/hooks";

const DEFAULT_BAR_COUNT = 40;
const DEFAULT_BAR_W = 4;
const DEFAULT_BAR_GAP = 2;
const DEFAULT_MIN_H = 2;
const DEFAULT_RANGE = 36;

/**
 * Live (recording) tuning.
 *
 * The native meter reports RMS, which sits far below a peak scale and never
 * reaches 1, so the live bars are auto-gained against a rolling maximum
 * instead of being drawn at face value. One bar is committed per interval
 * rather than per frame: at 60fps the whole window scrolls past in under a
 * second, which reads as a flicker instead of a recording.
 */
const LIVE_BAR_INTERVAL_MS = 70;
const LIVE_GAIN_RELEASE = 0.94;
const LIVE_MIN_GAIN = 0.008;
const LIVE_HEIGHT_CURVE = 0.75;
const LIVE_BAR_ANIM_MS = 90;

export interface AudioWaveformProps {
  /**
   * A static peak array, a shared peak array, or a live scalar amplitude. The
   * scalar form lets the waveform own its rolling window, so callers do not
   * have to keep a second array in sync.
   */
  amplitudes: number[] | SharedValue<number[]> | SharedValue<number>;
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
  /** Live mode only: whether the recorder is still feeding the meter. */
  liveActive?: boolean;
  /** Live mode only: how much audio each live bar covers. */
  liveBarIntervalMs?: number;
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
  /** Live mode: the committed bar heights, oldest first. */
  liveBars?: SharedValue<number[]>;
}

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
  liveBars,
}: BarItemProps) {
  const style = useAnimatedStyle(() => {
    const step = Math.max(minBarHeight, measuredWidth.value / barCount);
    const w = Math.max(minBarHeight, Math.min(barWidth, step - barGap));

    if (liveBars) {
      const bars = liveBars.value;
      const raw = index < bars.length ? bars[index] : undefined;

      // Not recorded yet: a muted hairline the live bars grow over.
      if (raw === undefined) {
        return {
          position: "absolute",
          left: index * step,
          top: (canvasHeight - minBarHeight) / 2,
          width: w,
          height: minBarHeight,
          borderRadius: w / 2,
          backgroundColor: inactiveColor,
        };
      }

      const h = Math.round(
        minBarHeight +
          Math.pow(raw, LIVE_HEIGHT_CURVE) * (canvasHeight - minBarHeight),
      );
      return {
        position: "absolute",
        left: index * step,
        // The height and its offset animate together so a bar grows from the
        // centre instead of snapping.
        top: withTiming(Math.max(0, (canvasHeight - h) / 2), {
          duration: LIVE_BAR_ANIM_MS,
        }),
        width: w,
        height: withTiming(h, { duration: LIVE_BAR_ANIM_MS }),
        borderRadius: w / 2,
        backgroundColor: activeColor,
      };
    }

    const h = Math.max(minBarHeight, barHeights.value[index] ?? minBarHeight);
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
  liveActive = true,
  liveBarIntervalMs = LIVE_BAR_INTERVAL_MS,
  onSeek,
  onSeeking,
  onScrubStateChange,
  style,
}: AudioWaveformProps): React.ReactElement {
  const { color } = useTheme();

  const finalActiveColor = activeColor ?? color.brand;
  const finalInactiveColor = inactiveColor ?? color.foreground;

  const isSharedValue = !!amplitudes && "value" in amplitudes;
  // Reanimated strict mode forbids reading `.value` during render, so the
  // scalar-vs-array discrimination happens after commit instead. A given
  // shared value never changes kind, so one check per source is enough; the
  // first (static) render is harmless because the live paths only arm once
  // `liveAmplitude` resolves.
  const [liveAmplitude, setLiveAmplitude] =
    useState<SharedValue<number> | null>(null);
  useEffect(() => {
    if (!isSharedValue) {
      setLiveAmplitude(null);
      return;
    }
    const sv = amplitudes as SharedValue<number | number[]>;
    setLiveAmplitude(
      Array.isArray(sv.value) ? null : (sv as SharedValue<number>),
    );
  }, [amplitudes, isSharedValue]);

  const localAmplitudes = useSharedValue<number[]>(
    isSharedValue ? [] : ((amplitudes as number[]) ?? []),
  );

  useEffect(() => {
    if (!isSharedValue) {
      localAmplitudes.value = (amplitudes as number[]) || [];
    }
  }, [amplitudes, isSharedValue, localAmplitudes]);

  const peaksSV = isSharedValue
    ? (amplitudes as SharedValue<number[]>)
    : localAmplitudes;

  const initialBars = useRef<number[] | null>(null);
  if (initialBars.current === null) {
    initialBars.current = new Array(barCount).fill(minBarHeight);
  }
  const barHeights = useSharedValue<number[]>(initialBars.current);
  const measuredWidth = useSharedValue(200);

  /**
   * Live recording state. `liveBars` holds the committed envelope, oldest
   * first, capped at `barCount`: once it is full the oldest bar is dropped,
   * which is what makes the waveform slide.
   */
  const liveBars = useSharedValue<number[]>([]);
  /** The most recent meter reading. */
  const liveLevel = useSharedValue(0);
  /** The loudest sample seen since the last bar was committed. */
  const livePeak = useSharedValue(0);
  /** Rolling maximum the live bars are normalised against. */
  const liveGain = useSharedValue(0);
  /** Bumped on every bar interval to drive the commit on the UI thread. */
  const liveTick = useSharedValue(0);

  useAnimatedReaction(
    // Live mode feeds the meter through its own path, so the static array
    // never changes here.
    () => (liveAmplitude ? null : peaksSV.value),
    (amps) => {
      if (!amps || amps.length === 0) return;

      const prev = barHeights.value;
      const next = new Array(barCount);
      const sourceCount = amps.length;
      let changed = false;

      for (let i = 0; i < barCount; i++) {
        let peak = 0;
        if (sourceCount === barCount) {
          peak = amps[i] ?? 0;
        } else {
          const start = Math.floor((i * sourceCount) / barCount);
          const end = Math.max(
            start + 1,
            Math.floor(((i + 1) * sourceCount) / barCount),
          );
          for (let j = start; j < end && j < sourceCount; j++) {
            const v = amps[j] ?? 0;
            if (v > peak) peak = v;
          }
        }

        const n = Math.min(1, Math.max(0, peak));
        const h = Math.round(minBarHeight + Math.pow(n, 0.5) * DEFAULT_RANGE);
        if (h !== prev[i]) changed = true;
        next[i] = h;
      }

      if (changed) barHeights.value = next;
    },
    [peaksSV, barCount, minBarHeight, liveAmplitude],
  );

  // The meter reports the instantaneous level at frame rate. Only the loudest
  // sample of each bar window is kept, so a syllable is not lost between two
  // quiet frames.
  useAnimatedReaction(
    () => (liveAmplitude ? liveAmplitude.value : -1),
    (value) => {
      if (liveAmplitude === null || value < 0) return;
      if (value > livePeak.value) livePeak.value = value;
      liveLevel.value = value;
    },
    [liveAmplitude],
  );

  // Commit one bar per interval.
  useAnimatedReaction(
    () => liveTick.value,
    () => {
      // A level that never changed during the window is still the level, so
      // the current reading counts even when no change was reported.
      const peak = Math.max(livePeak.value, liveLevel.value);
      livePeak.value = 0;

      // Instant attack, slow release: a quiet passage still reads as speech,
      // and a loud passage does not leave the waveform pinned afterwards.
      const gain = liveGain.value;
      liveGain.value = Math.max(
        peak > gain ? peak : gain * LIVE_GAIN_RELEASE,
        LIVE_MIN_GAIN,
      );
      const normalized = Math.min(1, peak / liveGain.value);

      const bars = liveBars.value;
      const next = bars.length >= barCount ? bars.slice(1) : bars.slice();
      next.push(normalized);
      liveBars.value = next;
    },
    [liveTick, barCount],
  );

  // The interval runs on the JS thread so the waveform keeps advancing even
  // while the meter sits at a constant level.
  useEffect(() => {
    if (!liveAmplitude || !liveActive) {
      liveBars.value = [];
      liveLevel.value = 0;
      livePeak.value = 0;
      liveGain.value = 0;
      return;
    }

    liveBars.value = [];
    liveLevel.value = 0;
    livePeak.value = 0;
    liveGain.value = 0;

    const id = setInterval(() => {
      liveTick.value = liveTick.value + 1;
    }, liveBarIntervalMs);

    return (): void => {
      clearInterval(id);
    };
  }, [
    liveAmplitude,
    liveActive,
    liveBarIntervalMs,
    liveBars,
    liveLevel,
    livePeak,
    liveGain,
    liveTick,
  ]);

  const handleLayout = (event: LayoutChangeEvent): void => {
    measuredWidth.value = event.nativeEvent.layout.width;
  };

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
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[{ height, flex: 1, justifyContent: "center" }, style]}
          onLayout={handleLayout}
        >
          <Box
            style={{
              height: 2,
              borderRadius: 1,
              opacity: opacity.disabled,
              backgroundColor: color.muted,
            }}
          />
        </Animated.View>
      </GestureDetector>
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
              liveBars={liveAmplitude ? liveBars : undefined}
            />
          ))}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
