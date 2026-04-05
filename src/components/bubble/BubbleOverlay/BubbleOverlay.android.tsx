import React, { useEffect, useRef } from 'react';
import { Dimensions, View, ViewStyle } from 'react-native';
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
} from 'react-native-reanimated';
import { CheckmarkIcon } from 'src/assets/icons/CheckmarkIcon';
import { ExclamationIcon } from 'src/assets/icons/ExclamationIcon';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { SpinnerIcon } from 'src/assets/icons/SpinnerIcon';
import { AudioWaveform } from 'src/components/common/AudioWaveform';
import { useBubble } from 'src/hooks';
import { useTheme } from 'src/hooks/useTheme';
import { useAudioStore, useSettingsStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';
import { BubbleNative } from 'src/utils/BubbleModule';

const BUBBLE_SIZE = 52;
const SCREEN = Dimensions.get('window');
const DEFAULT_X = SCREEN.width - BUBBLE_SIZE - 16;
const DEFAULT_Y = SCREEN.height * 0.3;

export const BubbleOverlay = (): React.ReactElement | null => {
  const tokens = useTheme();
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

  // Done state auto-reset after 3 seconds
  useEffect(() => {
    if (recordingState === RecordingState.Done) {
      doneTimer.current = setTimeout(() => {
        resetAudioState();
      }, 3000);
    }
    return (): void => {
      if (doneTimer.current !== null) {
        clearTimeout(doneTimer.current);
      }
    };
  }, [recordingState, resetAudioState]);

  // Error state auto-reset after 5 seconds
  useEffect(() => {
    if (recordingState === RecordingState.Error) {
      errorTimer.current = setTimeout(() => {
        resetAudioState();
      }, 5000);
    }
    return (): void => {
      if (errorTimer.current !== null) {
        clearTimeout(errorTimer.current);
      }
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

  // SPINNER ANIMATION for processing state
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

  const spinnerStyle = useAnimatedStyle(
    (): ViewStyle => ({
      transform: [{ rotate: `${spinRotation.value}deg` }],
    }),
  );

  // BACKGROUND COLOUR per state
  const getBubbleColor = (): string => {
    switch (recordingState) {
      case RecordingState.Recording:
        return tokens.color.bubble.recording;
      case RecordingState.Processing:
        return tokens.color.bubble.processing;
      case RecordingState.Done:
        return tokens.color.bubble.done;
      case RecordingState.Error:
        return tokens.color.bubble.error;
      default:
        return tokens.color.bubble.idle;
    }
  };

  const bubbleColor = useSharedValue(tokens.color.bubble.idle);

  useEffect(() => {
    bubbleColor.value = withTiming(getBubbleColor(), {
      duration: 200,
    });
  }, [recordingState]);

  // DRAG GESTURE with edge snapping
  const startX = useSharedValue(DEFAULT_X);
  const startY = useSharedValue(DEFAULT_Y);

  const savePosition = (x: number, y: number): void => {
    BubbleNative.savePosition(x, y);
  };

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
      // Snap to nearest horizontal edge
      const snapX =
        translateX.value < SCREEN.width / 2
          ? 16
          : SCREEN.width - BUBBLE_SIZE - 16;
      translateX.value = withSpring(snapX, { damping: 15 });
      // Clamp Y within screen
      const clampedY = Math.max(
        60,
        Math.min(SCREEN.height - BUBBLE_SIZE - 60, translateY.value),
      );
      translateY.value = withSpring(clampedY, { damping: 15 });
      runOnJS(savePosition)(snapX, clampedY);
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(handleBubbleTap)();
  });

  const composed = Gesture.Simultaneous(panGesture, tapGesture);

  const bubbleAnimatedStyle = useAnimatedStyle(
    (): ViewStyle => ({
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
      ],
    }),
  );

  const pulseAnimatedStyle = useAnimatedStyle(
    (): ViewStyle => ({
      transform: [{ scale: pulseScale.value }],
      opacity: pulseOpacity.value,
    }),
  );

  if (!bubbleEnabled) return null;

  return (
    <View className="absolute inset-0 pointer-events-none">
      {/* Pulse ring */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            borderRadius: BUBBLE_SIZE / 2,
            borderWidth: 1.5,
            borderColor: getBubbleColor(),
          },
          bubbleAnimatedStyle,
          pulseAnimatedStyle,
        ]}
      />

      {/* Bubble */}
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: BUBBLE_SIZE,
              height: BUBBLE_SIZE,
              borderRadius: BUBBLE_SIZE / 2,
              backgroundColor: getBubbleColor(),
              alignItems: 'center',
              justifyContent: 'center',
            },
            bubbleAnimatedStyle,
          ]}
        >
          {recordingState === RecordingState.Idle && (
            <MicrophoneIcon size={20} color={tokens.color.brand.bright} />
          )}

          {recordingState === RecordingState.Recording && (
            <AudioWaveform
              amplitudes={[0.5, 0.8, 0.4, 0.9, 0.6]} // Mock amplitudes for recording animation
              progress={1}
              width={24}
              height={20}
              interactive={false}
              style={{ opacity: 1 }}
            />
          )}

          {recordingState === RecordingState.Processing && (
            <SpinnerIcon
              size={20}
              color={tokens.color.brand.bright}
              animatedStyle={spinnerStyle}
            />
          )}

          {recordingState === RecordingState.Done && (
            <CheckmarkIcon size={20} color={tokens.color.text.inverse} />
          )}

          {recordingState === RecordingState.Error && (
            <ExclamationIcon size={20} color={tokens.color.text.inverse} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};
