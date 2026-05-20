import { useSelector } from '@legendapp/state/react';
import React, { useEffect, useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { bubbleColors } from '@/constants/colors';
import { useMetering, useTheme } from '@/hooks';
import { audio$, audioActions, settings$, RecordingState } from '@/store';

// Live Activity management — expo-widgets
const updateLiveActivity = (_state: RecordingState): void => {
  // Logic placeholder for Live Activity
};

export function LensBubble(): React.ReactElement | null {
  const { isDark, color } = useTheme();
  const bubbleTheme = bubbleColors(isDark);
  const recordingState = useSelector(() => audio$.recordingState.get());
  const bubbleEnabled = useSelector(() => settings$.bubbleEnabled.get());
  const { resetAudioState } = audioActions;

  const liveAmplitude = useMetering();

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          recordingState === RecordingState.Recording
            ? withSpring(1 + liveAmplitude.value * 0.15, {
                damping: 12,
                stiffness: 300,
                mass: 0.3,
              })
            : withSpring(1),
      },
    ],
  }));

  // Sync state to Live Activity
  useEffect(() => {
    updateLiveActivity(recordingState);
  }, [recordingState]);

  // Auto-reset timers
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (recordingState === RecordingState.Done) {
      timer = setTimeout(() => resetAudioState(), 3000);
    } else if (recordingState === RecordingState.Error) {
      timer = setTimeout(() => resetAudioState(), 5000);
    }
    return (): void => timer && clearTimeout(timer);
  }, [recordingState, resetAudioState]);

  // THEME COLORS
  const onPrimaryColor = color.onPrimary;
  const stateColor = useMemo(() => {
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

  const stateLabel = useMemo(() => {
    switch (recordingState) {
      case RecordingState.Recording:
        return 'Recording';
      case RecordingState.Processing:
        return 'Processing';
      case RecordingState.Done:
        return 'Done';
      case RecordingState.Error:
        return 'Error';
      default:
        return 'Ekwe ready';
    }
  }, [recordingState]);

  if (!bubbleEnabled) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: stateColor },
        pillAnimatedStyle,
      ]}
    >
      <MicrophoneIcon size={14} color={onPrimaryColor} />
      <Text style={styles.label}>{stateLabel}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: '#ffffff',
    fontWeight: '500',
    fontSize: 12,
  },
});
