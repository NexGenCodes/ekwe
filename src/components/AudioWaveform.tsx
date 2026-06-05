import React, { useMemo } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';

import { Box } from '@/components/ui';
import { borderRadius, opacity } from '@/constants/sizes';
import { useTheme } from '@/hooks';

export interface AudioWaveformProps {
  amplitudes: number[];
  progressSV: SharedValue<number>;
  duration: number;
  height?: number;
  width?: number;
  onSeek?: (progress: number) => void;
  onSeeking?: (progress: number) => void;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
}

export const AudioWaveform = ({
  amplitudes,
  progressSV,
  duration,
  height = 40,
  width = 200,
  onSeek,
  onSeeking,
  style,
  interactive = true,
}: AudioWaveformProps): React.ReactElement => {
  const { color } = useTheme();
  const measuredWidth = useSharedValue(width);

  const handleLayout = (event: LayoutChangeEvent): void => {
    measuredWidth.value = event.nativeEvent.layout.width;
  };

  const gesture = Gesture.Pan()
    .enabled(interactive)
    .onUpdate((event): void => {
      if (onSeek) {
        const newProgress = Math.max(
          0,
          Math.min(1, event.x / measuredWidth.value),
        );
        if (onSeeking) onSeeking(newProgress);
      }
    })
    .onEnd((event): void => {
      if (onSeek) {
        const newProgress = Math.max(
          0,
          Math.min(1, event.x / measuredWidth.value),
        );
        onSeek(newProgress);
      }
    })
    .runOnJS(true);

  const tap = Gesture.Tap()
    .enabled(interactive)
    .onEnd((event): void => {
      if (onSeek) {
        const newProgress = Math.max(
          0,
          Math.min(1, event.x / measuredWidth.value),
        );
        onSeek(newProgress);
      }
    })
    .runOnJS(true);

  const composed = Gesture.Exclusive(gesture, tap);

  const TERTIARY_COLOR = color.foreground;
  const PRIMARY_BRAND_COLOR = color.secondary;

  const progressStyle = useAnimatedStyle(() => {
    const normalizedProgress = duration > 0 ? progressSV.value / duration : 0;
    return {
      width: `${normalizedProgress * 100}%`,
    };
  });

  // Memoize computed bar heights — only recalculates when audio file changes
  const barHeights = useMemo(
    () => amplitudes.map((amp) => Math.max(4, amp * height)),
    [amplitudes, height],
  );

  // Pre-render bar Views — eliminates 100 allocations per parent render
  const inactiveBars = useMemo(
    () =>
      barHeights.map((h, index) => (
        <Box
          key={index}
          style={{
            width: 3,
            height: h,
            borderRadius: borderRadius.sm,
            backgroundColor: TERTIARY_COLOR,
            opacity: 0.15,
          }}
        />
      )),
    [barHeights, TERTIARY_COLOR],
  );

  const activeBars = useMemo(
    () =>
      barHeights.map((h, index) => (
        <Box
          key={index}
          style={{
            width: 3,
            height: h,
            borderRadius: borderRadius.sm,
            backgroundColor: PRIMARY_BRAND_COLOR,
          }}
        />
      )),
    [barHeights, PRIMARY_BRAND_COLOR],
  );

  const innerWaveformStyle = useAnimatedStyle(() => {
    return {
      width: measuredWidth.value,
    };
  });

  const renderContent = (): React.ReactElement => {
    if (amplitudes.length === 0) {
      return (
        <Box
          style={{
            flex: 1,
            height: 2,
            borderRadius: borderRadius.sm,
            opacity: opacity.disabled,
            backgroundColor: color.muted,
          }}
        />
      );
    }

    return (
      <Box style={{ flex: 1, height, justifyContent: 'center' }}>
        <Box
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            height,
            width: '100%',
            position: 'absolute',
          }}
        >
          {inactiveBars}
        </Box>

        <Animated.View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              height,
              overflow: 'hidden',
              position: 'absolute',
              zIndex: 1,
            },
            progressStyle,
          ]}
        >
          <Animated.View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                height,
              },
              innerWaveformStyle,
            ]}
          >
            {activeBars}
          </Animated.View>
        </Animated.View>
      </Box>
    );
  };

  return (
    <GestureDetector gesture={composed}>
      <Box
        style={[
          {
            height,
            flex: 1,
          },
          style,
        ]}
        onLayout={handleLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Audio Waveform"
      >
        {renderContent()}
      </Box>
    </GestureDetector>
  );
};
