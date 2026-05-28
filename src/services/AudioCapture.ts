import * as Haptics from "expo-haptics";
import { Linking } from "react-native";
import { AudioContext } from "react-native-audio-api";

import { PLAN_LIMITS } from "@/constants/billing";
import { EkweError } from "@/constants/errors";
import AudioService from "@/services/AudioService";
import { VolumeManager } from "@/services/VolumeManager";
import { auth$ } from "@/store";
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
  meteringData: number[]; // Added for waveform consistency
}

class AudioCaptureClass {
  private meteringInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private currentMeteringData: number[] = []; // Track during session
  private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: ((amplitude: number) => void)[] = [];
  private statusListeners: ((status: "started" | "stopped") => void)[] = [];
  private onAutoStopCallback: (() => void) | null = null;
  private isStartingParams = false;

  /**
   * Requests microphone permission.
   */
  async requestPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const status = await AudioService.requestPermission();
      if (status === "Granted") return ok(true);

      if (status === "Denied" || status === "Restricted") {
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

  /**
   * Checks if microphone permission is already granted.
   */
  async checkPermission(): Promise<Result<boolean, EkweError>> {
    try {
      const status = await AudioService.checkPermission();
      return ok(status === "Granted");
    } catch {
      return err(EkweError.PERMISSION_MIC);
    }
  }

  /**
   * Starts a new recording session safely.
   */
  async startRecording(
    sessionId: string,
    onAutoStop?: () => void,
  ): Promise<Result<void, EkweError>> {
    // If starting or already recording, try to recover instead of failing immediately
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
      this.currentMeteringData = []; // Reset for new session
      this.onAutoStopCallback = onAutoStop ?? null;
      await AudioService.startRecording();
      this.notifyStatusListeners("started");

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (isAndroid) {
        await attachAudioEffects(0);
      }

      // Begin metering and silence detection loop
      let silenceStartTime: number | null = null;
      const SILENCE_THRESHOLD_DB = -45; // Slightly less sensitive to low-level hum
      const SILENCE_DURATION_MS = 8000; // 8 seconds of absolute silence before auto-stop

      this.meteringInterval = setInterval(async () => {
        if (!this.currentSessionId) return;

        const db = AudioService.getMetering();

        // --- Silence Auto-Stop Logic ---
        if (db < SILENCE_THRESHOLD_DB) {
          if (silenceStartTime === null) {
            silenceStartTime = Date.now();
          } else if (Date.now() - silenceStartTime > SILENCE_DURATION_MS) {
            logger.info("AudioCapture: Silence detected, auto-stopping...");

            // Synchronously clear the interval to prevent race conditions while waiting for the native bridge
            if (this.meteringInterval !== null) {
              clearInterval(this.meteringInterval);
              this.meteringInterval = null;
            }

            // Distinct haptic for auto-stop — Warning tells user the mic cut off by itself
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

        // --- Metering UI Update ---
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
        this.currentMeteringData.push(db); // Store raw dB for accurate post-processing analysis
        if (this.listeners.length > 0) {
          this.notifyListeners(normalized);
        }
      }, 32);

      // --- Max Duration Safety Net (Dynamic Cap based on plan) ---
      const isPro = auth$.isPro.get();
      const safetyCapMs = isPro
        ? PLAN_LIMITS.pro.dictationDurationMs
        : PLAN_LIMITS.free.dictationDurationMs;

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

  /**
   * Stops the current recording session.
   */
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

      if (duration < 500) {
        this.currentSessionId = null;
        this.currentMeteringData = [];
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

  /**
   * Cancels the current recording and returns the path to the partial file for cleanup.
   */
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
    this.notifyListeners(0); // Reset UI waveform
    await VolumeManager.restoreVolume();

    if (isAndroid) {
      await releaseAudioEffects();
    }

    return ok(path);
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
    if (!validationResult.ok) {
      return err(validationResult.error);
    }

    let durationMs = 0;
    try {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(uri);
      durationMs = Math.round(decoded.duration * 1000);
      await context.close();
    } catch {
      // Non-critical — duration defaults to 0 if we can't decode
    }

    return ok({
      uri: validationResult.value.uri,
      durationMs,
      meteringData: [],
    });
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
