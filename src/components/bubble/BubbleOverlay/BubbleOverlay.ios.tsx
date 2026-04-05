import { useColorScheme } from 'nativewind';
import React, { useEffect, useMemo } from 'react';
import { Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { bubbleColors, getColor } from 'src/constants/colors';
import { useMetering } from 'src/hooks';
import { useAudioStore, useSettingsStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';

// Live Activity management — expo-widgets
const updateLiveActivity = (_state: RecordingState): void => {
  // Logic placeholder for Live Activity
};

export const BubbleOverlay = (): React.ReactElement | null => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const bubbleTheme = bubbleColors(isDark);
  const recordingState = useAudioStore((s) => s.recordingState);
  const bubbleEnabled = useSettingsStore((s) => s.bubbleEnabled);
  const resetAudioState = useAudioStore((s) => s.resetAudioState);

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

  // THEME COLORS (Pre-calculated for UI thread safety)
  const onPrimaryColor = useMemo(() => getColor('onPrimary', isDark), [isDark]);
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
      className="absolute top-15 self-center rounded-full flex-row items-center gap-2 px-3 py-1"
      style={[{ backgroundColor: stateColor }, pillAnimatedStyle]}
    >
      <MicrophoneIcon size={14} color={onPrimaryColor} />
      <Text className="uppercase tracking-widest text-white font-medium text-xs">
        {stateLabel}
      </Text>
    </Animated.View>
  );
};
