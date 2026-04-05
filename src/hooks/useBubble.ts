import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { EkweError } from 'src/constants/errors';
import { useAudioCapture } from 'src/hooks/useAudioCapture';
import { useAudioStore, useSettingsStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';
import { Result, ok, err } from 'src/types/Result';
import { BubbleNative } from 'src/utils/BubbleModule';

export interface UseBubbleReturn {
  enableBubble: () => Promise<Result<void, EkweError>>;
  disableBubble: () => Promise<void>;
  handleBubbleTap: () => Promise<void>;
  isReady: boolean;
}

export const useBubble = (): UseBubbleReturn => {
  const { startRecording, stopRecording } = useAudioCapture();
  const recordingState = useAudioStore((s) => s.recordingState);
  const audioPath = useAudioStore((s) => s.audioPath);
  const setBubbleEnabled = useSettingsStore((s) => s.setBubbleEnabled);
  const bubbleEnabled = useSettingsStore((s) => s.bubbleEnabled);

  // When recording finishes and audioPath is set,
  // automatically kick off transcription
  useEffect(() => {
    if (recordingState === RecordingState.Done && audioPath !== null) {
      // audioPath is set — transcription was already triggered
      // in stopRecording via useAudioCapture.
      // This effect is a safety net for edge cases.
    }
  }, [recordingState, audioPath]);

  /**
   * Enables the bubble. On Android checks overlay permission
   * and starts the foreground service.
   * On iOS requests notification permission.
   */
  const enableBubble = useCallback(async (): Promise<
    Result<void, EkweError>
  > => {
    if (Platform.OS === 'android') {
      const hasPermission = await BubbleNative.hasOverlayPermission();
      if (!hasPermission) {
        await BubbleNative.requestOverlayPermission();
        // Permission dialog is async — the user may grant or deny.
        // The settings screen handles the deny case by checking
        // hasOverlayPermission again after the user returns.
        return err(EkweError.PERMISSION_OVERLAY);
      }
      // Android 15 ordering — enable bubble in UI first,
      // then start the service after overlay is confirmed.
      setBubbleEnabled(true);
      const serviceResult = await BubbleNative.startBubbleService();
      if (!serviceResult.ok) {
        setBubbleEnabled(false);
        return err(serviceResult.error);
      }
      return ok(undefined);
    }

    // iOS — just enable, Live Activity starts on first use
    setBubbleEnabled(true);
    return ok(undefined);
  }, [setBubbleEnabled]);

  /**
   * Disables the bubble. Stops the foreground service on Android.
   */
  const disableBubble = useCallback(async (): Promise<void> => {
    setBubbleEnabled(false);
    if (Platform.OS === 'android') {
      await BubbleNative.stopBubbleService();
    }
  }, [setBubbleEnabled]);

  /**
   * Called when the user taps the bubble.
   * Toggles recording state.
   */
  const handleBubbleTap = useCallback(async (): Promise<void> => {
    if (
      recordingState === RecordingState.Idle ||
      recordingState === RecordingState.Error ||
      recordingState === RecordingState.Done
    ) {
      await startRecording();
    } else if (recordingState === RecordingState.Recording) {
      const stopResult = await stopRecording();
      if (stopResult.ok) {
        // stopRecording sets audioPath in the store.
        // useTranscription watches the store and kicks off
        // transcription automatically in the Result screen.
      }
    }
  }, [recordingState, startRecording, stopRecording]);

  return {
    enableBubble,
    disableBubble,
    handleBubbleTap,
    isReady: bubbleEnabled,
  };
};
