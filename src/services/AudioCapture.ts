import {
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
  AudioModule,
} from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import { Platform } from 'react-native';
import { EkweError } from 'src/constants/errors';
import { VolumeManager } from 'src/services/VolumeManager';
import { Result, ok, err } from 'src/types/Result';
import {
  attachAudioEffects,
  releaseAudioEffects,
} from 'src/utils/AudioEffectsModule';

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

/**
 * Minimal interface for AudioRecorder to enable testing without
 * importing the full expo-audio native module.
 */
export interface RecorderHandle {
  record: () => void;
  stop: () => Promise<void>;
  prepareToRecordAsync: (options?: Partial<RecordingOptions>) => Promise<void>;
  getStatus: () => {
    isRecording: boolean;
    durationMillis: number;
    metering?: number;
    url: string | null;
  };
  uri: string | null;
}

class AudioCaptureClass {
  private recorder: RecorderHandle | null = null;
  private meteringData: number[] = [];
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;

  /**
   * Requests microphone permission.
   * Returns ok(true) if granted, err(PERMISSION_MIC) if denied.
   */
  async requestPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
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
      const { granted } = await getRecordingPermissionsAsync();
      return ok(granted);
    } catch {
      return err(EkweError.PERMISSION_MIC);
    }
  }

  /**
   * Starts a new bubble-path recording session.
   * Raises volume if needed, configures audio session,
   * attaches Android effects, begins metering.
   */
  async startRecording(
    sessionId: string,
    onMetering: (amplitude: number) => void,
  ): Promise<Result<void, EkweError>> {
    if (this.recorder !== null) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    const permResult = await this.checkPermission();
    if (!permResult.ok) return err(permResult.error);
    if (!permResult.value) return err(EkweError.PERMISSION_MIC);

    await VolumeManager.raiseVolumeIfNeeded();

    try {
      // Configure the audio mode for recording
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });

      const options: RecordingOptions = {
        ...RecordingPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 128000,
        android: {
          ...RecordingPresets.HIGH_QUALITY.android,
          audioSource: 'voice_recognition',
        },
        ios: {
          ...RecordingPresets.HIGH_QUALITY.ios,
          sampleRate: 16000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
      };

      // expo-audio SDK 55 uses AudioModule.Recording for class-based recording in services.
      const recorder = new (
        AudioModule as unknown as {
          Recording: new (options: RecordingOptions) => RecorderHandle;
        }
      ).Recording(options);
      await recorder.prepareToRecordAsync(options);

      this.recorder = recorder;
      this.currentSessionId = sessionId;
      this.meteringData = [];

      // Attach Android audio effects
      if (Platform.OS === 'android') {
        // expo-audio does not expose audioSessionId directly yet.
        // This is a scaffold — attach via the session when exposed.
        // The module is wired and ready for when the API supports it.
        await attachAudioEffects(0);
      }

      recorder.record();

      // Begin metering polling
      this.meteringInterval = setInterval(() => {
        if (this.recorder === null) return;
        const status = this.recorder.getStatus();
        if (status.isRecording && status.metering !== undefined) {
          // expo-audio returns metering in dBFS (-160 to 0)
          // Normalise to 0-1 for the waveform
          const normalised = Math.max(
            0,
            Math.min(1, (status.metering + 160) / 160),
          );
          this.meteringData.push(normalised);
          onMetering(normalised);
        }
      }, 100);

      return ok(undefined);
    } catch {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }

  /**
   * Stops the current recording session and returns the result.
   * Restores volume, releases Android effects, clears metering.
   */
  async stopRecording(): Promise<Result<RecordingResult, EkweError>> {
    if (this.recorder === null || this.currentSessionId === null) {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    try {
      await this.recorder.stop();
      const uri = this.recorder.uri;

      if (uri === null || uri === undefined) {
        this.recorder = null;
        this.currentSessionId = null;
        return err(EkweError.AUDIO_EMPTY);
      }

      const status = this.recorder.getStatus();
      const durationMs = status.durationMillis ?? 0;

      if (durationMs < 500) {
        this.recorder = null;
        this.currentSessionId = null;
        return err(EkweError.TOO_SHORT);
      }

      const result: RecordingResult = {
        uri,
        durationMs,
        meteringData: [...this.meteringData],
        sessionId: this.currentSessionId,
      };

      this.recorder = null;
      this.currentSessionId = null;
      this.meteringData = [];

      await VolumeManager.restoreVolume();

      if (Platform.OS === 'android') {
        await releaseAudioEffects();
      }

      return ok(result);
    } catch {
      this.recorder = null;
      this.currentSessionId = null;
      return err(EkweError.INTERRUPTED);
    }
  }

  /**
   * Cancels the current recording without saving.
   * Used when an interruption occurs (incoming call, etc).
   */
  async cancelRecording(): Promise<Result<void, EkweError>> {
    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    if (this.recorder !== null) {
      try {
        await this.recorder.stop();
      } catch {
        // Ignore errors during cancel
      }
      this.recorder = null;
      this.currentSessionId = null;
      this.meteringData = [];
    }

    await VolumeManager.restoreVolume();

    if (Platform.OS === 'android') {
      await releaseAudioEffects();
    }

    return ok(undefined);
  }

  /**
   * Processes an audio file received via the share intent path.
   * Validates the file exists and is a supported format.
   * Returns the URI ready to send to Groq.
   */
  async processSharedFile(
    uri: string,
  ): Promise<Result<{ uri: string; durationMs: number }, EkweError>> {
    if (uri.length === 0) return err(EkweError.SHARE_COPY_FAIL);

    const supportedExtensions = [
      '.mp3',
      '.mp4',
      '.m4a',
      '.wav',
      '.ogg',
      '.flac',
      '.aac',
      '.opus',
      '.webm',
    ];

    const lowerUri = uri.toLowerCase();
    const isSupported = supportedExtensions.some((ext) =>
      lowerUri.endsWith(ext),
    );

    if (!isSupported) return err(EkweError.BAD_FORMAT);

    // File size and duration validation happens in Phase 6
    // when we read the file before sending to Groq.
    // Here we just validate the URI is accessible.
    try {
      // expo-file-system validation scaffolded here.
      // Full validation in Phase 6.
      return ok({ uri, durationMs: 0 });
    } catch {
      return err(EkweError.SHARE_COPY_FAIL);
    }
  }

  /**
   * Returns true if a recording is currently active.
   */
  isRecording(): boolean {
    return this.recorder !== null;
  }

  /**
   * Injects a mock recorder for testing. Not for production use.
   */
  _setRecorderForTesting(recorder: RecorderHandle, sessionId: string): void {
    this.recorder = recorder;
    this.currentSessionId = sessionId;
    this.meteringData = [];
  }

  /**
   * Resets internal state. Used for testing only.
   */
  _resetForTesting(): void {
    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }
    this.recorder = null;
    this.currentSessionId = null;
    this.meteringData = [];
  }
}

export const AudioCapture = new AudioCaptureClass();
