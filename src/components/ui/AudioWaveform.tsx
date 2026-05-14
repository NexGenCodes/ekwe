import React from 'react';
import { View, LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
} from 'react-native-reanimated';

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

  const TERTIARY_COLOR = color.border;
  const PRIMARY_BRAND_COLOR = color.primary;

  const progressStyle = useAnimatedStyle(() => {
    const normalizedProgress = duration > 0 ? progressSV.value / duration : 0;
    return {
      width: `${normalizedProgress * 100}%`,
    };
  });

  const renderBars = (isActive: boolean): React.ReactElement[] => {
    return amplitudes.map((amp, index) => (
      <View
        key={index}
        style={{
          width: 3,
          height: Math.max(4, amp * height),
          borderRadius: 1.5,
          backgroundColor: isActive ? PRIMARY_BRAND_COLOR : TERTIARY_COLOR,
        }}
      />
    ));
  };

  const innerWaveformStyle = useAnimatedStyle(() => {
    return {
      width: measuredWidth.value,
    };
  });

  const renderContent = (): React.ReactElement => {
    if (amplitudes.length === 0) {
      return (
        <View
          style={{
            flex: 1,
            height: 2,
            borderRadius: 1,
            opacity: 0.5,
            backgroundColor: '#a1a1aa',
          }}
        />
      );
    }

    return (
      <View style={{ flex: 1, height, justifyContent: 'center' }}>
        {/* Background Layer (Muted) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            height,
            width: '100%',
            position: 'absolute',
          }}
        >
          {renderBars(false)}
        </View>

        {/* Foreground Layer (Active/Colored) */}
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
            {renderBars(true)}
          </Animated.View>
        </Animated.View>
      </View>
    );
  };

  return (
    <GestureDetector gesture={composed}>
      <View
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
      </View>
    </GestureDetector>
  );
};
