import { useColorScheme } from 'nativewind';
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { bubbleColors } from 'src/constants/colors';
import { useAudioStore, useSettingsStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';

// Live Activity management — expo-widgets
// Full Live Activity wiring requires native module config.
// The widget target must be configured in Xcode.

const updateLiveActivity = (state: RecordingState): void => {
  // expo-widgets Live Activity API:
  // import { LiveActivity } from 'expo-widgets'
  // LiveActivity.update({ state: state })
  // Requires Xcode target configuration to test.
};

export const BubbleOverlay = (): React.ReactElement | null => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const bubbleTheme = bubbleColors(isDark);
  const recordingState = useAudioStore((s) => s.recordingState);
  const bubbleEnabled = useSettingsStore((s) => s.bubbleEnabled);
  const resetAudioState = useAudioStore((s) => s.resetAudioState);

  // Sync state to Live Activity
  useEffect(() => {
    updateLiveActivity(recordingState);
  }, [recordingState]);

  // Done auto-reset
  useEffect(() => {
    if (recordingState === RecordingState.Done) {
      const timer = setTimeout(() => resetAudioState(), 3000);
      return (): void => clearTimeout(timer);
    }
    return undefined;
  }, [recordingState, resetAudioState]);

  // Error auto-reset
  useEffect(() => {
    if (recordingState === RecordingState.Error) {
      const timer = setTimeout(() => resetAudioState(), 5000);
      return (): void => clearTimeout(timer);
    }
    return undefined;
  }, [recordingState, resetAudioState]);

  if (!bubbleEnabled) return null;

  // On iOS the in-app indicator is a minimal status pill
  // at the top of the screen — the real experience is the
  // Dynamic Island / lock screen Live Activity
  const getStateColor = (): string => {
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
  };

  const getStateLabel = (): string => {
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
  };

  return (
    <View
      className="absolute top-15 self-center rounded-full flex-row items-center gap-2 px-3 py-1"
      style={{
        backgroundColor: getStateColor(),
      }}
    >
      <MicrophoneIcon size={14} color="#FFFFFF" />
      <Text className="uppercase tracking-widest text-white font-medium text-xs">
        {getStateLabel()}
      </Text>
    </View>
  );
};
