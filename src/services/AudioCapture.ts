import { Platform } from 'react-native';
import { EkweError } from 'src/constants/errors';
import { VolumeManager } from 'src/services/VolumeManager';
import { Result, ok, err } from 'src/types/Result';
import {
  attachAudioEffects,
  releaseAudioEffects,
} from 'src/utils/AudioEffectsModule';
import { validateSharedAudio } from 'src/utils/fileValidation';

import AudioService from './AudioService';

export interface CaptureSession {
  sessionId: string;
  startTime: number;
  meteringCallback: (amplitude: number) => void;
}

export interface RecordingResult {
  uri: string;
  durationMs: number;
  meteringData: number[];
  sessionId: string;
}

class AudioCaptureClass {
  private meteringData: number[] = [];
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private listeners: ((amplitude: number) => void)[] = [];

  /**
   * Requests microphone permission.
   */
  async requestPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const granted = await AudioService.requestPermission();
      if (!granted) return err(EkweError.PERMISSION_MIC);
      return ok(true);
    } catch {
      return err(EkweError.PERMISSION_MIC);
    }
  }

  /**
   * Checks if microphone permission is already granted.
   */
  async checkPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const granted = await AudioService.checkPermission();
      return ok(granted);
    } catch {
      return err(EkweError.PERMISSION_MIC);
    }
  }

  /**
   * Starts a new recording session.
   */
  async startRecording(
    sessionId: string,
    onMetering: (amplitude: number) => void,
  ): Promise<Result<void, EkweError>> {
    if (AudioService.isRecording()) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    const permResult = await this.checkPermission();
    if (!permResult.ok) return err(permResult.error);
    if (!permResult.value) return err(EkweError.PERMISSION_MIC);

    await VolumeManager.raiseVolumeIfNeeded();

    try {
      await AudioService.startRecording();

      this.currentSessionId = sessionId;
      this.meteringData = [];

      // Attach Android audio effects if session 0 is supported
      if (Platform.OS === 'android') {
        await attachAudioEffects(0);
      }

      // Begin metering polling at ~60fps to sync with display refresh rate.
      this.meteringInterval = setInterval(() => {
        const db = AudioService.getMetering();
        this.meteringData.push(db);
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
        onMetering(normalized);
        this.notifyListeners(normalized);
      }, 16);

      return ok(undefined);
    } catch {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }

  /**
   * Stops the current recording session.
   */
  async stopRecording(): Promise<Result<RecordingResult, EkweError>> {
    if (!AudioService.isRecording() || this.currentSessionId === null) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    try {
      const { path, duration } = await AudioService.stopRecording();

      if (duration < 500) {
        return err(EkweError.TOO_SHORT);
      }

      const result: RecordingResult = {
        uri: path,
        durationMs: duration,
        meteringData: [...this.meteringData],
        sessionId: this.currentSessionId,
      };

      this.currentSessionId = null;
      this.meteringData = [];

      await VolumeManager.restoreVolume();

      if (Platform.OS === 'android') {
        await releaseAudioEffects();
      }

      return ok(result);
    } catch {
      this.currentSessionId = null;
      return err(EkweError.INTERRUPTED);
    }
  }

  /**
   * Cancels the current recording.
   */
  async cancelRecording(): Promise<Result<void, EkweError>> {
    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    try {
      await AudioService.stopRecording();
    } catch {
      // Ignore errors during cancel
    }

    this.currentSessionId = null;
    this.meteringData = [];

    await VolumeManager.restoreVolume();

    if (Platform.OS === 'android') {
      await releaseAudioEffects();
    }

    return ok(undefined);
  }

  /**
   * Processes an audio file received via share.
   */
  async processSharedFile(
    uri: string,
  ): Promise<Result<{ uri: string; durationMs: number }, EkweError>> {
    const validationResult = await validateSharedAudio(uri);
    if (!validationResult.ok) {
      return err(validationResult.error);
    }
    return ok({ uri: validationResult.value.uri, durationMs: 0 });
  }

  /**
   * Returns true if a recording is currently active.
   */
  isRecording(): boolean {
    return AudioService.isRecording();
  }

  /**
   * Adds a listener for real-time metering updates.
   */
  addListener(callback: (amplitude: number) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notifyListeners(amplitude: number): void {
    this.listeners.forEach((l) => l(amplitude));
  }
}

export const AudioCapture = new AudioCaptureClass();
