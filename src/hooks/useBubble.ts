import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useForegroundApp } from './useForegroundApp';

import { EkweError } from '@/constants/errors';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { VoiceNoteScanner } from '@/services/VoiceNoteScanner';
import { useAudioStore, useSettingsStore } from '@/store';
import { RecordingState } from '@/store/audioSlice';
import { Result, ok, err } from '@/types/Result';
import { BubbleNative } from '@/utils/BubbleModule';

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
  const setDuration = useAudioStore((s) => s.setDuration);
  const setRecordingState = useAudioStore((s) => s.setRecordingState);
  const setAudioPath = useAudioStore((s) => s.setAudioPath);
  const setActiveFloatingHead = useAudioStore((s) => s.setActiveFloatingHead);
  const setBubbleEnabled = useSettingsStore((s) => s.setBubbleEnabled);
  const bubbleEnabled = useSettingsStore((s) => s.bubbleEnabled);

  const { strategy } = useForegroundApp(bubbleEnabled);
  const magicNoteUri = useRef<string | null>(null);

  // Sync visibility and mode based on foreground app
  useEffect(() => {
    if (!bubbleEnabled) return;

    const syncState = async () => {
      // 1. Handle Visibility
      const shouldHide =
        strategy.hideBubble || strategy.packageName === 'unknown';
      await BubbleNative.updateVisibility(!shouldHide);

      if (shouldHide) return;

      // 2. Handle Magic Mode for Messaging Apps
      if (strategy.recommendedMode === 'MEDIA_SCAN') {
        const note = await VoiceNoteScanner.findRecentVoiceNote(
          strategy.packageName,
        );
        if (note) {
          magicNoteUri.current = note.uri;
          await BubbleNative.updateState('MAGIC');
        } else {
          magicNoteUri.current = null;
          await BubbleNative.updateState('IDLE');
        }
      }
      // 3. Handle Alert Mode for Dating Apps (Requires system record)
      else if (strategy.recommendedMode === 'SYSTEM_AUDIO') {
        magicNoteUri.current = null;
        await BubbleNative.updateState('RECORD');
      } else {
        magicNoteUri.current = null;
        await BubbleNative.updateState('IDLE');
      }
    };

    syncState();
  }, [strategy, bubbleEnabled]);

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
        return err(EkweError.PERMISSION_OVERLAY);
      }

      const audioState = useAudioStore.getState();
      if (audioState.activeFloatingHead === 'card') {
        console.log('[Exclusivity] Cannot start bubble while card is active');
        return ok(undefined);
      }

      setBubbleEnabled(true);
      setActiveFloatingHead('bubble');
      const serviceResult = await BubbleNative.startBubbleService();
      if (!serviceResult.ok) {
        setBubbleEnabled(false);
        setActiveFloatingHead('none');
        return err(serviceResult.error);
      }
      return ok(undefined);
    }

    // iOS — just enable, Live Activity starts on first use
    setBubbleEnabled(true);
    setActiveFloatingHead('bubble');
    return ok(undefined);
  }, [setBubbleEnabled, setActiveFloatingHead]);

  /**
   * Disables the bubble. Stops the foreground service on Android.
   */
  const disableBubble = useCallback(async (): Promise<void> => {
    setBubbleEnabled(false);
    setActiveFloatingHead('none');
    if (Platform.OS === 'android') {
      await BubbleNative.stopBubbleService();
    }
  }, [setBubbleEnabled, setActiveFloatingHead]);

  /**
   * Called when the user taps the bubble.
   * Toggles recording state or processes a 'magic' voice note.
   */
  const handleBubbleTap = useCallback(async (): Promise<void> => {
    // Magic Flow: If we have a pre-found voice note, process it immediately
    if (magicNoteUri.current) {
      setRecordingState(RecordingState.Processing);
      // Simulate/Set final state to trigger the result screen
      setAudioPath(magicNoteUri.current);
      // We don't have duration for scanned files easily without deeper probing,
      // but the translation service handles it fine.
      setDuration(0);
      setRecordingState(RecordingState.Done);
      // Clear magic ref after use
      magicNoteUri.current = null;
      await BubbleNative.updateState('IDLE');
      return;
    }

    if (
      strategy.recommendedMode === 'SYSTEM_AUDIO' &&
      Platform.OS === 'android'
    ) {
      if (recordingState === RecordingState.Recording) {
        await BubbleNative.stopAudioCapture();
        const stopResult = await stopRecording();
      } else {
        await BubbleNative.requestMediaProjection();
        await startRecording();
      }
      return;
    }

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
      }
    }
  }, [
    recordingState,
    startRecording,
    stopRecording,
    setRecordingState,
    setAudioPath,
    setDuration,
  ]);

  return {
    enableBubble,
    disableBubble,
    handleBubbleTap,
    isReady: bubbleEnabled,
  };
};
