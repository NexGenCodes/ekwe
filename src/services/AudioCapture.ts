import * as Haptics from 'expo-haptics';
import { Platform, Alert, Linking } from 'react-native';

import AudioService from './AudioService';

import { EkweError } from '@/constants/errors';
import { VolumeManager } from '@/services/VolumeManager';
import { Result, ok, err } from '@/types/Result';
import {
  attachAudioEffects,
  releaseAudioEffects,
} from '@/utils/AudioEffectsModule';
import { validateSharedAudio } from '@/utils/fileValidation';

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
      const status = await AudioService.requestPermission();
      if (status === 'Granted') return ok(true);

      if (status === 'Denied' || status === 'Restricted') {
        Alert.alert(
          'Microphone Required',
          'Ekwe needs microphone access to record and translate voice notes. Please enable it in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }

      return err(EkweError.PERMISSION_MIC);
    } catch {
      return err(EkweError.PERMISSION_MIC);
    }
  }

  /**
   * Checks if microphone permission is already granted.
   */
  async checkPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const status = await AudioService.checkPermission();
      return ok(status === 'Granted');
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
    const isAlreadyRecording = AudioService.isRecording();
    if (isAlreadyRecording) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    const permResult = await this.checkPermission();
    if (!permResult.ok) return err(permResult.error);
    if (!permResult.value) return err(EkweError.PERMISSION_MIC);

    await VolumeManager.raiseVolumeIfNeeded();

    try {
      this.currentSessionId = sessionId;
      this.meteringData = [];

      await AudioService.startRecording();

      // Pro-level haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Attach Android audio effects if session 0 is supported
      if (Platform.OS === 'android') {
        await attachAudioEffects(0);
      }

      // Begin metering polling at ~30fps to reduce JS thread load while maintaining visual smoothness.
      this.meteringInterval = setInterval(() => {
        const db = AudioService.getMetering();
        // db is typically -160 to 0
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

        this.meteringData.push(db);
        onMetering(normalized);
        this.notifyListeners(normalized);
      }, 32);

      return ok(undefined);
    } catch {
      this.currentSessionId = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }

  /**
   * Stops the current recording session.
   */
  async stopRecording(): Promise<Result<RecordingResult, EkweError>> {
    const sessionId = this.currentSessionId;
    const isRecording = AudioService.isRecording();
    if (!isRecording || !sessionId) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    try {
      const { path, duration } = await AudioService.stopRecording();

      if (duration < 500) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return err(EkweError.TOO_SHORT);
      }

      const result: RecordingResult = {
        uri: path,
        durationMs: duration,
        meteringData: [...this.meteringData],
        sessionId,
      };

      this.currentSessionId = null;
      this.meteringData = [];

      await VolumeManager.restoreVolume();

      if (Platform.OS === 'android') {
        await releaseAudioEffects();
      }

      // Success feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      return ok(result);
    } catch {
      this.currentSessionId = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
    mimeType?: string,
  ): Promise<Result<{ uri: string; durationMs: number }, EkweError>> {
    const validationResult = await validateSharedAudio(uri, mimeType);
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
