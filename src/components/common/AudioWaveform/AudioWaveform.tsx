import React from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import { Tokens } from 'src/constants/tokens';
import { useTheme } from 'src/hooks/useTheme';

import { AudioWaveformProps } from './AudioWaveform.types';

const BAR_WIDTH = 3;

export const AudioWaveform = ({
  amplitudes,
  progress,
  height = 40,
  width = 200,
  onSeek,
  style,
  interactive = true,
}: AudioWaveformProps): React.ReactElement => {
  const { tokens } = useTheme();
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
        <View
          style={[
            styles.emptyBaseline,
            { backgroundColor: tokens.color.background.tertiary },
          ]}
        />
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
          tokens={tokens}
          height={height}
        />
      );
    });
  };

  return (
    <GestureDetector gesture={composed}>
      <View
        style={[styles.container, { height, width }, style]}
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
  tokens: Tokens;
  height: number;
}

const WaveformBar = ({
  amplitude,
  isActive,
  tokens,
  height,
}: BarProps): React.ReactElement => {
  const activeValue = useSharedValue(isActive ? 1 : 0);

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
        [tokens.color.background.tertiary, tokens.color.brand.core],
      );

      return {
        backgroundColor: color,
        height: Math.max(4, amplitude * height),
      };
    },
  );

  return <Animated.View style={[styles.bar, animatedStyle]} />;
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
  emptyBaseline: {
    width: '100%',
    height: 2,
    borderRadius: 1,
    opacity: 0.5,
  },
});
