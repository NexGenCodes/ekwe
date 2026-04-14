import React, { useEffect, useRef, useMemo } from 'react';
import { Dimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  SharedValue,
} from 'react-native-reanimated';

import { CheckmarkIcon } from '@/assets/icons/CheckmarkIcon';
import { ExclamationIcon } from '@/assets/icons/ExclamationIcon';
import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { SpinnerIcon } from '@/assets/icons/SpinnerIcon';
import { bubbleColors, getColor } from '@/constants/colors';
import { useBubble, useMetering } from '@/hooks';
import { useTheme } from '@/hooks/useTheme';
import { useAudioStore, useSettingsStore } from '@/store';
import { RecordingState } from '@/store/audioSlice';
import { BubbleNative } from '@/utils/BubbleModule';

const BUBBLE_SIZE = 52;
const SCREEN = Dimensions.get('window');
const DEFAULT_X = SCREEN.width - BUBBLE_SIZE - 16;
const DEFAULT_Y = SCREEN.height * 0.3;

export function LensBubble(): React.ReactElement | null {
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const bubbleTheme = bubbleColors(isDark);
  const recordingState = useAudioStore((s) => s.recordingState);
  const resetAudioState = useAudioStore((s) => s.resetAudioState);
  const bubbleEnabled = useSettingsStore((s) => s.bubbleEnabled);

  const { handleBubbleTap } = useBubble();

  const translateX = useSharedValue(DEFAULT_X);
  const translateY = useSharedValue(DEFAULT_Y);
  const isDragging = useSharedValue(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved position on mount
  useEffect(() => {
    BubbleNative.getSavedPosition().then((pos) => {
      if (pos !== null) {
        translateX.value = pos.x;
        translateY.value = pos.y;
      }
    });
  }, []);

  // Auto-reset timers
  useEffect(() => {
    if (recordingState === RecordingState.Done) {
      doneTimer.current = setTimeout(() => resetAudioState(), 3000);
    } else if (recordingState === RecordingState.Error) {
      errorTimer.current = setTimeout(() => resetAudioState(), 5000);
    }
    return (): void => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [recordingState, resetAudioState]);

  // PULSE ANIMATION
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.4);

  useEffect(() => {
    if (recordingState === RecordingState.Idle) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.35, { duration: 2000 }),
          withTiming(1, { duration: 0 }),
        ),
        -1,
        false,
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 2000 }),
          withTiming(0.4, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else if (recordingState === RecordingState.Recording) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.35, { duration: 600 }),
          withTiming(1, { duration: 0 }),
        ),
        -1,
        false,
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 600 }),
          withTiming(0.5, { duration: 0 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
      pulseScale.value = withTiming(1);
      pulseOpacity.value = withTiming(0);
    }
  }, [recordingState]);

  // LIVE METERING
  const liveAmplitude = useMetering();
  const h0 = useSharedValue(0);
  const h1 = useSharedValue(0);
  const h2 = useSharedValue(0);
  const h3 = useSharedValue(0);
  const h4 = useSharedValue(0);
  const history = useMemo(() => [h0, h1, h2, h3, h4], [h0, h1, h2, h3, h4]);

  useAnimatedReaction(
    () => liveAmplitude.value,
    (val) => {
      if (recordingState === RecordingState.Recording) {
        history[4].value = withSpring(val, {
          damping: 12,
          stiffness: 300,
          mass: 0.3,
        });
        history[3].value = withSpring(val, {
          damping: 14,
          stiffness: 280,
          mass: 0.3,
        });
        history[2].value = withSpring(val, {
          damping: 16,
          stiffness: 260,
          mass: 0.3,
        });
        history[1].value = withSpring(val, {
          damping: 18,
          stiffness: 240,
          mass: 0.3,
        });
        history[0].value = withSpring(val, {
          damping: 20,
          stiffness: 220,
          mass: 0.3,
        });
      }
    },
    [recordingState],
  );

  useEffect(() => {
    if (recordingState !== RecordingState.Recording) {
      history.forEach((h) => (h.value = 0));
    }
  }, [recordingState]);

  // SPINNER
  const spinRotation = useSharedValue(0);
  useEffect(() => {
    if (recordingState === RecordingState.Processing) {
      spinRotation.value = withRepeat(
        withTiming(360, { duration: 700 }),
        -1,
        false,
      );
    } else {
      cancelAnimation(spinRotation);
      spinRotation.value = 0;
    }
  }, [recordingState]);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  // THEME COLORS
  const bubbleColorValue = useMemo(() => {
    switch (recordingState) {
      case RecordingState.Recording:
        return bubbleTheme.recording;
      case RecordingState.Processing:
        return bubbleTheme.processing;
      case RecordingState.Done:
        return bubbleTheme.done;
      case RecordingState.Error:
        return bubbleTheme.error;
      default:
        return bubbleTheme.idle;
    }
  }, [recordingState, bubbleTheme]);

  const onPrimaryColor = useMemo(() => getColor('onPrimary', isDark), [isDark]);

  const bubbleColor = useSharedValue(bubbleTheme.idle);
  useEffect((): void => {
    bubbleColor.value = withTiming(bubbleColorValue, { duration: 200 });
  }, [bubbleColorValue, bubbleColor]);

  const MeterBar = ({
    value,
    color,
  }: {
    value: SharedValue<number>;
    color: string;
  }): React.ReactElement => {
    const animatedStyle = useAnimatedStyle(() => ({
      height: Math.max(4, value.value * 20),
    }));
    return (
      <Animated.View
        style={[
          { width: 3, borderRadius: 1.5, backgroundColor: color },
          animatedStyle,
        ]}
      />
    );
  };

  // GESTURES
  const startX = useSharedValue(DEFAULT_X);
  const startY = useSharedValue(DEFAULT_Y);
  const panGesture = Gesture.Pan()
    .onStart(() => {
      isDragging.value = true;
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
      translateY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      isDragging.value = false;
      const snapX =
        translateX.value < SCREEN.width / 2
          ? 16
          : SCREEN.width - BUBBLE_SIZE - 16;
      translateX.value = withSpring(snapX, { damping: 15 });
      const clampedY = Math.max(
        60,
        Math.min(SCREEN.height - BUBBLE_SIZE - 60, translateY.value),
      );
      translateY.value = withSpring(clampedY, { damping: 15 });
      runOnJS(BubbleNative.savePosition)(snapX, clampedY);
    });

  const tapGesture = Gesture.Tap().onEnd(() => runOnJS(handleBubbleTap)());
  const composed = Gesture.Simultaneous(panGesture, tapGesture);

  const bubbleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  if (!bubbleEnabled) return null;

  return (
    <View className="absolute inset-0 pointer-events-none">
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            borderRadius: BUBBLE_SIZE / 2,
            borderWidth: 1.5,
            borderColor: bubbleColorValue,
          },
          bubbleAnimatedStyle,
          pulseAnimatedStyle,
        ]}
      />
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: BUBBLE_SIZE,
              height: BUBBLE_SIZE,
              borderRadius: BUBBLE_SIZE / 2,
              backgroundColor: bubbleColorValue,
              alignItems: 'center',
              justifyContent: 'center',
            },
            bubbleAnimatedStyle,
          ]}
        >
          {recordingState === RecordingState.Idle && (
            <MicrophoneIcon size={20} color={onPrimaryColor} />
          )}
          {recordingState === RecordingState.Recording && (
            <View className="flex-row items-center gap-0.5">
              {history.map((h, i) => (
                <MeterBar key={i} value={h} color={onPrimaryColor} />
              ))}
            </View>
          )}
          {recordingState === RecordingState.Processing && (
            <SpinnerIcon
              size={20}
              color={onPrimaryColor}
              animatedStyle={spinnerStyle}
            />
          )}
          {recordingState === RecordingState.Done && (
            <CheckmarkIcon size={20} color={onPrimaryColor} />
          )}
          {recordingState === RecordingState.Error && (
            <ExclamationIcon size={20} color={onPrimaryColor} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
