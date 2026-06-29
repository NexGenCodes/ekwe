import React, { useEffect, useMemo } from "react";
import { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Canvas, RoundedRect, Group } from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useDerivedValue,
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
  style?: StyleProp<ViewStyle>;
}

interface BarItemProps {
  index: number;
  x: number;
  barHeights: SharedValue<number[]>;
  progressSV?: SharedValue<number>;
  duration: number;
  barCount: number;
  canvasHeight: number;
  barWidth: number;
  barRadius: number;
  minBarHeight: number;
  activeColor: string;
  inactiveColor: string;
}

const BarItem = React.memo(function BarItem({
  index,
  x,
  barHeights,
  progressSV,
  duration,
  barCount,
  canvasHeight,
  barWidth,
  barRadius,
  minBarHeight,
  activeColor,
  inactiveColor,
}: BarItemProps) {
  const h = useDerivedValue(() => {
    return Math.max(minBarHeight, barHeights.value[index] ?? minBarHeight);
  });

  // Centered vertically for WhatsApp style
  const y = useDerivedValue(() => {
    return (canvasHeight - h.value) / 2;
  });

  const color = useDerivedValue(() => {
    if (!progressSV) return activeColor;
    const dur = duration ?? 1;
    const frac = dur > 0 ? progressSV.value / dur : 0;
    return index / barCount <= frac ? activeColor : inactiveColor;
  });

  return (
    <RoundedRect
      x={x}
      y={y}
      width={barWidth}
      height={h}
      r={barRadius}
      color={color}
    />
  );
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
  style,
}: AudioWaveformProps): React.ReactElement {
  const { color } = useTheme();
  
  const finalActiveColor = activeColor ?? color.brand;
  const finalInactiveColor = inactiveColor ?? color.foreground;

  const isSharedValue = amplitudes && 'value' in amplitudes;
  const localAmplitudes = useSharedValue<number[]>(isSharedValue ? [] : (amplitudes as number[]));

  useEffect(() => {
    if (!isSharedValue) {
      localAmplitudes.value = (amplitudes as number[]) || [];
    }
  }, [amplitudes, isSharedValue, localAmplitudes]);

  const targetAmplitudes = isSharedValue ? (amplitudes as SharedValue<number[]>) : localAmplitudes;

  const barHeights = useSharedValue<number[]>(new Array(barCount).fill(minBarHeight));
  const measuredWidth = useSharedValue(200);

  useAnimatedReaction(
    () => targetAmplitudes.value,
    (amps) => {
      if (!amps || amps.length === 0) return;
      
      const arr = new Array(barCount);
      const isPlayback = amps.length > barCount;
      
      for (let i = 0; i < barCount; i++) {
        let raw = 0;
        if (isPlayback) {
          const chunk = Math.floor(amps.length / barCount);
          const start = i * chunk;
          const end = start + chunk;
          let sum = 0;
          for (let j = start; j < end; j++) {
            sum += amps[j] ?? 0;
          }
          raw = chunk > 0 ? sum / chunk : 0;
        } else {
          raw = amps[i] ?? 0;
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

  const gesture = Gesture.Pan()
    .enabled(interactive)
    .onUpdate((event) => {
      if (onSeeking) {
        const progress = Math.max(0, Math.min(1, event.x / measuredWidth.value));
        runOnJS(onSeeking)(progress);
      }
    })
    .onEnd((event) => {
      if (onSeek) {
        const progress = Math.max(0, Math.min(1, event.x / measuredWidth.value));
        runOnJS(onSeek)(progress);
      }
    });

  const tap = Gesture.Tap()
    .enabled(interactive)
    .onEnd((event) => {
      if (onSeek) {
        const progress = Math.max(0, Math.min(1, event.x / measuredWidth.value));
        runOnJS(onSeek)(progress);
      }
    });

  const composed = Gesture.Exclusive(gesture, tap);

  const bars = useMemo(() => {
    const step = barWidth + barGap;
    const result: { i: number; x: number }[] = [];
    for (let i = 0; i < barCount; i++) {
      result.push({ i, x: i * step });
    }
    return result;
  }, [barCount, barWidth, barGap]);

  if (!isSharedValue && (!amplitudes || (amplitudes as number[]).length === 0)) {
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
        <Canvas style={{ flex: 1, height }}>
          <Group>
            {bars.map(({ i, x }) => (
              <BarItem
                key={i}
                index={i}
                x={x}
                barHeights={barHeights}
                progressSV={progressSV}
                duration={duration ?? 1}
                barCount={barCount}
                canvasHeight={height}
                barWidth={barWidth}
                barRadius={barWidth / 2} // Pill shape
                minBarHeight={minBarHeight}
                activeColor={finalActiveColor}
                inactiveColor={finalInactiveColor}
              />
            ))}
          </Group>
        </Canvas>
      </Animated.View>
    </GestureDetector>
  );
}
