import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { useTheme } from 'src/hooks/useTheme';
import { useAudioStore, useSettingsStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';

// Live Activity management — expo-widgets SDK 55
// Full Live Activity wiring is scaffolded here.
// The widget target is configured in Phase 8 during
// the Xcode target setup for App Store submission.

const updateLiveActivity = (state: RecordingState): void => {
  // expo-widgets Live Activity API:
  // import { LiveActivity } from 'expo-widgets'
  // LiveActivity.update({ state: state })
  // Scaffolded — wired in Phase 8 after Xcode target is configured.
};

export const BubbleOverlay = (): React.ReactElement | null => {
  const tokens = useTheme();
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
      className="absolute top-15 self-center rounded-full flex-row items-center gap-2"
      style={{
        backgroundColor: getStateColor(),
        paddingHorizontal: tokens.space[3],
        paddingVertical: tokens.space[1],
      }}
    >
      <MicrophoneIcon size={14} color={tokens.color.text.inverse} />
      <Text
        className="uppercase tracking-widest text-white"
        style={{
          fontFamily: tokens.font.family.bodyMed,
          fontSize: tokens.font.size.caption,
        }}
      >
        {getStateLabel()}
      </Text>
    </View>
  );
};
