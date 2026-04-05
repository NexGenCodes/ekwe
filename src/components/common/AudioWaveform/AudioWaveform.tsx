import { useColorScheme } from 'nativewind';
import React from 'react';
import { View, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import { getColor } from 'src/constants/colors';

import { AudioWaveformProps } from './AudioWaveform.types';

export const AudioWaveform = ({
  amplitudes,
  progress,
  height = 40,
  width = 200,
  onSeek,
  style,
  interactive = true,
}: AudioWaveformProps): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const measuredWidth = useSharedValue(width);
  const isDark = colorScheme === 'dark';

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

  const renderContent = (): React.ReactElement | React.ReactElement[] => {
    if (amplitudes.length === 0) {
      return (
        <View className="w-full h-0.5 rounded-full opacity-50 bg-zinc-200 dark:bg-zinc-800" />
      );
    }

    return amplitudes.map((amp, index) => {
      const barProgress = index / amplitudes.length;
      const isActive = barProgress <= progress;

      return (
        <WaveformBar
          key={index}
          amplitude={amp}
          isActive={isActive}
          height={height}
          isDark={isDark}
        />
      );
    });
  };

  return (
    <GestureDetector gesture={composed}>
      <View
        className="flex-row items-center justify-between"
        style={[{ height, width }, style]}
        onLayout={handleLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Audio Waveform"
        accessibilityValue={{ min: 0, max: 100, now: progress * 100 }}
      >
        {renderContent()}
      </View>
    </GestureDetector>
  );
};

interface BarProps {
  amplitude: number;
  isActive: boolean;
  height: number;
  isDark: boolean;
}

const WaveformBar = ({
  amplitude,
  isActive,
  height,
  isDark,
}: BarProps): React.ReactElement => {
  const activeValue = useSharedValue(isActive ? 1 : 0);

  // Constants for colors to avoid using tokens.ts directly
  const TERTIARY_COLOR = getColor('border', isDark);
  const PRIMARY_BRAND_COLOR = getColor('primary', isDark); // Unified Ekwe blue

  React.useEffect(() => {
    activeValue.value = withSpring(isActive ? 1 : 0, { damping: 20 });
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(
    (): {
      backgroundColor: string;
      height: number;
    } => {
      const color = interpolateColor(
        activeValue.value,
        [0, 1],
        [TERTIARY_COLOR, PRIMARY_BRAND_COLOR],
      );

      return {
        backgroundColor: color,
        height: Math.max(4, amplitude * height),
      };
    },
  );

  return (
    <Animated.View className="w-[3px] rounded-full" style={animatedStyle} />
  );
};
