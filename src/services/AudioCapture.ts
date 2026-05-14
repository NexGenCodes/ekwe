import * as Haptics from 'expo-haptics';
import { Platform, Linking } from 'react-native';

import AudioService from './AudioService';

import { EkweError } from '@/constants/errors';
import { VolumeManager } from '@/services/VolumeManager';
import { Result, ok, err } from '@/types/Result';
import {
  attachAudioEffects,
  releaseAudioEffects,
} from '@/utils/AudioEffectsModule';
import { AppAlert } from '@/utils/alert';
import { validateSharedAudio } from '@/utils/fileValidation';
import logger from '@/utils/logger';

export interface CaptureSession {
  sessionId: string;
  startTime: number;
}

export interface RecordingResult {
  uri: string;
  durationMs: number;
  sessionId: string;
  meteringData: number[]; // Added for waveform consistency
}

class AudioCaptureClass {
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private currentMeteringData: number[] = []; // Track during session
  private listeners: ((amplitude: number) => void)[] = [];
  private statusListeners: ((status: 'started' | 'stopped') => void)[] = [];
  private isStartingParams = false;

  /**
   * Requests microphone permission.
   */
  async requestPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const status = await AudioService.requestPermission();
      if (status === 'Granted') return ok(true);

      if (status === 'Denied' || status === 'Restricted') {
        AppAlert.info(
          'Microphone Required',
          'Ekwe needs microphone access to record and translate voice notes. Please enable it in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: (): Promise<void> => Linking.openSettings(),
            },
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
   * Starts a new recording session safely.
   */
  async startRecording(sessionId: string): Promise<Result<void, EkweError>> {
    // Concurrency Lock: Prevent multiple calls bridging
    if (this.isStartingParams || AudioService.isRecording()) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    this.isStartingParams = true;

    try {
      const permResult = await this.checkPermission();
      if (!permResult.ok || !permResult.value) {
        this.isStartingParams = false;
        return err(EkweError.PERMISSION_MIC);
      }

      await VolumeManager.raiseVolumeIfNeeded();

      this.currentSessionId = sessionId;
      this.currentMeteringData = []; // Reset for new session
      await AudioService.startRecording();
      this.notifyStatusListeners('started');

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (Platform.OS === 'android') {
        await attachAudioEffects(0);
      }

      // Begin metering and silence detection loop
      let silenceStartTime: number | null = null;
      const SILENCE_THRESHOLD_DB = -50;
      const SILENCE_DURATION_MS = 5000;

      this.meteringInterval = setInterval(async () => {
        if (!this.currentSessionId) return;

        const db = AudioService.getMetering();

        // --- Silence Auto-Stop Logic ---
        if (db < SILENCE_THRESHOLD_DB) {
          if (silenceStartTime === null) {
            silenceStartTime = Date.now();
          } else if (Date.now() - silenceStartTime > SILENCE_DURATION_MS) {
            logger.info('AudioCapture: Silence detected, auto-stopping...');

            // Synchronously clear the interval to prevent race conditions while waiting for the native bridge
            if (this.meteringInterval !== null) {
              clearInterval(this.meteringInterval);
              this.meteringInterval = null;
            }

            await this.stopRecording();
            return;
          }
        } else {
          silenceStartTime = null;
        }

        // --- Metering UI Update ---
        if (this.listeners.length > 0) {
          const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
          this.currentMeteringData.push(normalized); // Store for result
          this.notifyListeners(normalized);
        }
      }, 32);

      this.isStartingParams = false;
      return ok(undefined);
    } catch {
      this.currentSessionId = null;
      this.isStartingParams = false;
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
      this.notifyStatusListeners('stopped');

      if (duration < 500) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return err(EkweError.TOO_SHORT);
      }

      const result: RecordingResult = {
        uri: path,
        durationMs: duration,
        sessionId,
        meteringData: [...this.currentMeteringData],
      };

      this.currentSessionId = null;
      this.currentMeteringData = [];

      await VolumeManager.restoreVolume();

      if (Platform.OS === 'android') {
        await releaseAudioEffects();
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return ok(result);
    } catch {
      this.currentSessionId = null;
      this.notifyStatusListeners('stopped');
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
      this.notifyStatusListeners('stopped');
    } catch {
      // Ignore errors during cancel
    }

    this.currentSessionId = null;
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
  ): Promise<
    Result<
      { uri: string; durationMs: number; meteringData: number[] },
      EkweError
    >
  > {
    const validationResult = await validateSharedAudio(uri, mimeType);

    if (validationResult.ok) {
      return ok({
        uri: validationResult.value.uri,
        durationMs: 0,
        meteringData: [],
      });
    }

    return err(validationResult.error);
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

  /**
   * Adds a listener for recording status changes.
   */
  addStatusListener(
    callback: (status: 'started' | 'stopped') => void,
  ): () => void {
    this.statusListeners.push(callback);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== callback);
    };
  }

  private notifyStatusListeners(status: 'started' | 'stopped'): void {
    this.statusListeners.forEach((l) => l(status));
  }

  private notifyListeners(amplitude: number): void {
    this.listeners.forEach((l) => l(amplitude));
  }
}

export const AudioCapture = new AudioCaptureClass();
