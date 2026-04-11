import { useCallback, useEffect } from 'react';

import { EkweError } from '@/constants/errors';
import { AudioCapture } from '@/services/AudioCapture';
import { AudioProcessor } from '@/services/AudioProcessor';
import { useAudioStore } from '@/store';
import { RecordingState } from '@/store/audioSlice';
import { Result, ok, err } from '@/types/Result';

export interface UseAudioCaptureReturn {
  startRecording: () => Promise<Result<void, EkweError>>;
  stopRecording: () => Promise<Result<void, EkweError>>;
  cancelRecording: () => Promise<void>;
  isRecording: boolean;
  requestPermission: () => Promise<Result<boolean, EkweError>>;
}

/**
 * Hook that wires AudioCapture + AudioProcessor to the audio store.
 * Manages recording lifecycle: start → metering → stop → process → done.
 */
export const useAudioCapture = (): UseAudioCaptureReturn => {
  const setRecordingState = useAudioStore((s) => s.setRecordingState);
  const setError = useAudioStore((s) => s.setError);
  const setAudioPath = useAudioStore((s) => s.setAudioPath);
  const setSessionId = useAudioStore((s) => s.setSessionId);
  const setDuration = useAudioStore((s) => s.setDuration);
  const resetAudioState = useAudioStore((s) => s.resetAudioState);
  const recordingState = useAudioStore((s) => s.recordingState);

  // Clean up on unmount
  useEffect(() => {
    return (): void => {
      if (AudioCapture.isRecording()) {
        AudioCapture.cancelRecording();
      }
    };
  }, []);

  /**
   * Requests microphone permission via AudioCapture.
   */
  const requestPermission = useCallback(async (): Promise<
    Result<boolean, EkweError>
  > => {
    return AudioCapture.requestPermission();
  }, []);

  /**
   * Starts a recording session with a unique session ID.
   * Sets recording state to Recording on success.
   */
  const startRecording = useCallback(async (): Promise<
    Result<void, EkweError>
  > => {
    if (recordingState === RecordingState.Recording) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    const sessionId = crypto.randomUUID();
    setSessionId(sessionId);
    setRecordingState(RecordingState.Recording);

    const result = await AudioCapture.startRecording(
      sessionId,
      (_amplitude) => {
        // Amplitude values drive the AudioWaveform component if connected.
        // Currently handled directly by the BubbleOverlay animations.
      },
    );

    if (!result.ok) {
      setError(result.error);
      return err(result.error);
    }

    return ok(undefined);
  }, [recordingState, setRecordingState, setError, setSessionId]);

  /**
   * Stops the current recording, processes it, and updates the store.
   * Transitions: Recording → Processing → Done (or Error).
   */
  const stopRecording = useCallback(async (): Promise<
    Result<void, EkweError>
  > => {
    setRecordingState(RecordingState.Processing);

    const captureResult = await AudioCapture.stopRecording();

    if (!captureResult.ok) {
      setError(captureResult.error);
      return err(captureResult.error);
    }

    const { uri, durationMs, meteringData } = captureResult.value;

    const processResult = await AudioProcessor.processRecording(
      uri,
      durationMs,
      meteringData,
    );

    if (!processResult.ok) {
      setError(processResult.error);
      return err(processResult.error);
    }

    setAudioPath(processResult.value.uri);
    setDuration(Math.round(durationMs / 1000));
    setRecordingState(RecordingState.Done);

    return ok(undefined);
  }, [setRecordingState, setError, setAudioPath, setDuration]);

  /**
   * Cancels the current recording and resets the audio store.
   */
  const cancelRecording = useCallback(async (): Promise<void> => {
    await AudioCapture.cancelRecording();
    resetAudioState();
  }, [resetAudioState]);

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    isRecording: recordingState === RecordingState.Recording,
    requestPermission,
  };
};
