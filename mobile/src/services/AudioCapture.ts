import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Linking } from "react-native";

import { EkweError } from "@/constants/errors";
import AudioService from "@/services/AudioService";
import { VolumeManager } from "@/services/VolumeManager";
import { PLAN_LIMITS } from "@/constants/billing";
import { Result, ok, err } from "@/types/Result";
import { isAndroid, isIOS, triggerHaptic } from "@/utils";
import { releaseAudioEffects } from "@/utils/AudioEffectsModule";
import { AppAlert } from "@/utils/alert";
import { validateSharedAudio } from "@/utils/fileValidation";
import logger from "@/utils/logger";

import EkweNative from "../../modules/ekwe-native";

export interface CaptureSession {
  sessionId: string;
  startTime: number;
}

export interface RecordingResult {
  uri: string;
  durationMs: number;
  sessionId: string;
  meteringData: number[];
  waveform?: number[];
}

class AudioCaptureClass {
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private currentMeteringData: number[] = [];
  private currentRecordingPath: string | null = null;
  private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: ((amplitude: number) => void)[] = [];
  private statusListeners: ((status: "started" | "stopped") => void)[] = [];
  private onAutoStopCallback: (() => void) | null = null;
  private isStartingParams = false;

  async requestPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const status = await AudioService.requestPermission();
      if (status === "granted") return ok(true);

      if (status === "denied" || status === "restricted") {
        AppAlert.info(
          "Microphone Required",
          "Ekwe needs microphone access to record and translate voice notes. Please enable it in Settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
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

  async checkPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const status = await AudioService.checkPermission();
      return ok(status === "granted");
    } catch {
      return err(EkweError.PERMISSION_MIC);
    }
  }

  async startRecording(
    sessionId: string,
    onAutoStop?: () => void,
  ): Promise<Result<void, EkweError>> {
    if (this.isStartingParams) return err(EkweError.AUDIO_RECORD_FAIL);
    this.onAutoStopCallback = null;

    if (this.isRecording()) {
      logger.info(
        "AudioCapture: Already recording, stopping before restart...",
      );
      await this.stopRecording().catch(() => {});
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
      this.currentMeteringData = [];
      this.onAutoStopCallback = onAutoStop ?? null;

      const safetyCapMs = PLAN_LIMITS.pro.dictationDurationMs;

      if (isAndroid) {
        const cacheDir = FileSystem.cacheDirectory;
        if (!cacheDir) {
          this.isStartingParams = false;
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
        const outputPath = `${cacheDir}ekwe_recording_${sessionId}.flac`;
        const startResult = await EkweNative.startAudioRecording(
          outputPath,
          16000,
        );
        if (!startResult.success) {
          logger.error(
            "AudioCapture: AudioRecord start failed:",
            startResult.error,
          );
          this.isStartingParams = false;
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
        this.currentRecordingPath = outputPath;
      } else {
        try {
          await EkweNative.configureVoiceSession();
        } catch (e) {
          logger.warn("AudioCapture: configureVoiceSession failed", e);
        }
        await AudioService.startRecording(safetyCapMs);
      }

      this.notifyStatusListeners("started");

      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);

      let silenceStartTime: number | null = null;
      const SILENCE_THRESHOLD_DB = -45;
      const SILENCE_DURATION_MS = 8000;

      this.meteringInterval = setInterval(async () => {
        if (!this.currentSessionId) return;

        let db: number;
        if (isAndroid) {
          const amp = await EkweNative.getRecordingAmplitude();
          db = amp > 0.0001 ? 20 * Math.log10(amp) : -160;
        } else if (isIOS) {
          db = AudioService.getMetering();
        } else {
          db = -160;
        }

        if (db < SILENCE_THRESHOLD_DB) {
          if (silenceStartTime === null) {
            silenceStartTime = Date.now();
          } else if (Date.now() - silenceStartTime > SILENCE_DURATION_MS) {
            logger.info("AudioCapture: Silence detected, auto-stopping...");

            if (this.meteringInterval !== null) {
              clearInterval(this.meteringInterval);
              this.meteringInterval = null;
            }

            triggerHaptic(Haptics.NotificationFeedbackType.Warning);

            if (this.onAutoStopCallback) {
              this.onAutoStopCallback();
            } else {
              await this.stopRecording();
            }
            return;
          }
        } else {
          silenceStartTime = null;
        }

        let normalized = 0;
        if (db > -45) {
          normalized = Math.pow((db + 45) / 45, 1.5);
        } else {
          normalized = 0.02;
        }

        this.currentMeteringData.push(normalized);
        if (this.currentMeteringData.length > 10000) {
          this.currentMeteringData = this.currentMeteringData.filter(
            (_, i) => i % 2 === 0,
          );
        }
        if (this.listeners.length > 0) {
          this.notifyListeners(normalized);
        }
      }, 60);

      this.maxDurationTimeout = setTimeout(async () => {
        if (this.isRecording()) {
          logger.info(
            `AudioCapture: Max duration safety cap reached (${safetyCapMs / 1000}s), auto-stopping`,
          );
          if (this.onAutoStopCallback) {
            this.onAutoStopCallback();
          } else {
            await this.stopRecording();
          }
        }
      }, safetyCapMs);

      this.isStartingParams = false;
      return ok(undefined);
    } catch {
      if (this.meteringInterval !== null) {
        clearInterval(this.meteringInterval);
        this.meteringInterval = null;
      }
      this.currentSessionId = null;
      this.isStartingParams = false;
      triggerHaptic(Haptics.NotificationFeedbackType.Error);
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }

  async stopRecording(): Promise<Result<RecordingResult, EkweError>> {
    const sessionId = this.currentSessionId;
    if (!sessionId) {
      this.currentSessionId = null;
      this.currentMeteringData = [];
      return err(EkweError.AUDIO_RECORD_FAIL);
    }

    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    if (this.maxDurationTimeout !== null) {
      clearTimeout(this.maxDurationTimeout);
      this.maxDurationTimeout = null;
    }

    this.onAutoStopCallback = null;

    try {
      let uri: string;
      let durationMs: number;
      let waveform: number[] | undefined;

      if (isAndroid) {
        const result = await EkweNative.stopAudioRecording();
        if (!result.success) {
          this.currentSessionId = null;
          this.currentMeteringData = [];
          this.notifyStatusListeners("stopped");
          return err(EkweError.INTERRUPTED);
        }
        uri = this.currentRecordingPath ?? "";
        durationMs = result.durationMs;
        waveform = result.waveform;
        this.currentRecordingPath = null;
      } else {
        const isNativeRecording = AudioService.isRecording();
        if (!isNativeRecording) {
          this.currentSessionId = null;
          this.currentMeteringData = [];
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
        const { path, duration } = await AudioService.stopRecording();
        uri = path;
        durationMs = duration;
      }

      this.notifyStatusListeners("stopped");

      const result: RecordingResult = {
        uri,
        durationMs,
        sessionId,
        meteringData: [...this.currentMeteringData],
        ...(waveform !== undefined ? { waveform } : {}),
      };

      this.currentSessionId = null;
      this.currentMeteringData = [];

      await VolumeManager.restoreVolume();

      if (isAndroid) {
        await releaseAudioEffects();
      }

      triggerHaptic(Haptics.NotificationFeedbackType.Success);
      return ok(result);
    } catch {
      this.currentSessionId = null;
      this.notifyStatusListeners("stopped");
      triggerHaptic(Haptics.NotificationFeedbackType.Error);
      return err(EkweError.INTERRUPTED);
    }
  }

  async cancelRecording(): Promise<Result<string | null, EkweError>> {
    let path: string | null = null;
    this.onAutoStopCallback = null;

    if (this.meteringInterval !== null) {
      clearInterval(this.meteringInterval);
      this.meteringInterval = null;
    }

    if (this.maxDurationTimeout !== null) {
      clearTimeout(this.maxDurationTimeout);
      this.maxDurationTimeout = null;
    }

    try {
      if (isAndroid) {
        if (this.currentSessionId) {
          await EkweNative.stopAudioRecording();
          path = this.currentRecordingPath;
          this.currentRecordingPath = null;
        }
      } else {
        if (AudioService.isRecording()) {
          const result = await AudioService.stopRecording();
          path = result.path;
        }
      }
      this.notifyStatusListeners("stopped");
    } catch {
      // Ignore errors during cancel
    }

    this.currentSessionId = null;
    this.currentMeteringData = [];
    this.notifyListeners(0);
    await VolumeManager.restoreVolume();

    if (isAndroid) {
      await releaseAudioEffects();
    }

    return ok(path);
  }

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
    if (!validationResult.ok) {
      return err(validationResult.error);
    }

    const outputUri = validationResult.value.uri;

    return ok({
      uri: outputUri,
      durationMs: 0,
      meteringData: [],
    });
  }

  isRecording(): boolean {
    if (isAndroid) {
      return this.currentSessionId !== null;
    }
    return AudioService.isRecording();
  }

  addListener(callback: (amplitude: number) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  addStatusListener(
    callback: (status: "started" | "stopped") => void,
  ): () => void {
    this.statusListeners.push(callback);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== callback);
    };
  }

  private notifyStatusListeners(status: "started" | "stopped"): void {
    this.statusListeners.forEach((l) => l(status));
  }

  private notifyListeners(amplitude: number): void {
    this.listeners.forEach((l) => l(amplitude));
  }
}

export const AudioCapture = new AudioCaptureClass();
