import * as Haptics from "expo-haptics";
import { Linking } from "react-native";

import { EkweError } from "@/constants/errors";
import AudioService from "@/services/AudioService";
import { VolumeManager } from "@/services/VolumeManager";
import { PLAN_LIMITS } from "@/constants/billing";
import { Result, ok, err } from "@/types/Result";
import { isAndroid } from "@/utils";
import {
  attachAudioEffects,
  releaseAudioEffects,
} from "@/utils/AudioEffectsModule";
import { AppAlert } from "@/utils/alert";
import { validateSharedAudio } from "@/utils/fileValidation";
import logger from "@/utils/logger";

export interface CaptureSession {
  sessionId: string;
  startTime: number;
}

export interface RecordingResult {
  uri: string;
  durationMs: number;
  sessionId: string;
  meteringData: number[];
}

class AudioCaptureClass {
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private currentMeteringData: number[] = [];
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

    if (AudioService.isRecording()) {
      logger.info(
        "AudioCapture: Native recorder already active, stopping before restart...",
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
      await AudioService.startRecording(safetyCapMs);
      this.notifyStatusListeners("started");

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (isAndroid) {
        await attachAudioEffects(0);
      }

      let silenceStartTime: number | null = null;
      const SILENCE_THRESHOLD_DB = -45;
      const SILENCE_DURATION_MS = 8000;

      this.meteringInterval = setInterval(async () => {
        if (!this.currentSessionId) return;

        const db = AudioService.getMetering();

        if (db < SILENCE_THRESHOLD_DB) {
          if (silenceStartTime === null) {
            silenceStartTime = Date.now();
          } else if (Date.now() - silenceStartTime > SILENCE_DURATION_MS) {
            logger.info("AudioCapture: Silence detected, auto-stopping...");

            if (this.meteringInterval !== null) {
              clearInterval(this.meteringInterval);
              this.meteringInterval = null;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

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

        // WhatsApp-style noise gate:
        // Assume noise floor is around -45dB.
        // Scale -45..0 to 0..1 exponentially so voice pops and silence stays flat.
        let normalized = 0;
        if (db > -45) {
          normalized = Math.pow((db + 45) / 45, 1.5);
        } else {
          normalized = 0.02; // tiny dot for absolute silence
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }

  async stopRecording(): Promise<Result<RecordingResult, EkweError>> {
    const sessionId = this.currentSessionId;
    const isRecording = AudioService.isRecording();
    if (!isRecording || !sessionId) {
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
      const { path, duration } = await AudioService.stopRecording();
      this.notifyStatusListeners("stopped");

      const result: RecordingResult = {
        uri: path,
        durationMs: duration,
        sessionId,
        meteringData: [...this.currentMeteringData],
      };

      this.currentSessionId = null;
      this.currentMeteringData = [];

      await VolumeManager.restoreVolume();

      if (isAndroid) {
        await releaseAudioEffects();
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return ok(result);
    } catch {
      this.currentSessionId = null;
      this.notifyStatusListeners("stopped");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
      const result = await AudioService.stopRecording();
      path = result.path;
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
