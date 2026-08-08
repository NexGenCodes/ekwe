import { Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { Linking } from "react-native";

import { EkweError } from "@/constants/errors";
import AudioService from "@/services/AudioService";
import { Result, ok, err } from "@/types/Result";
import { isAndroid, isIOS, triggerHaptic } from "@/utils";
import { releaseAudioEffects } from "@/utils/AudioEffectsModule";
import { AppAlert } from "@/utils/alert";
import { validateSharedAudio } from "@/utils/fileValidation";
import logger from "@/utils/logger";

import EkweNative from "../../modules/ekwe-native";

export type CaptureMode = "file" | "live";

export interface CaptureSession {
  sessionId: string;
  startTime: number;
  mode: CaptureMode;
}

export interface RecordingResult {
  uri: string;
  durationMs: number;
  sessionId: string;
  meteringData: number[];
  waveform?: number[];
}

export interface OpusPacket {
  data: ArrayBuffer;
  sessionId: string;
}

class AudioCaptureClass {
  private currentSessionId: string | null = null;
  private currentMeteringData: number[] = [];
  private currentRecordingPath: string | null = null;
  private listeners: ((amplitude: number) => void)[] = [];
  private opusPacketListeners: ((packet: OpusPacket) => void)[] = [];
  private statusListeners: ((status: "started" | "stopped") => void)[] = [];
  private onAutoStopCallback: (() => void) | null = null;
  private amplitudeRafId: number | null = null;
  private isStartingParams = false;
  private currentMode: CaptureMode = "file";
  private opusPacketSub: { remove: () => void } | null = null;
  private vadSilenceSub: { remove: () => void } | null = null;

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
    mode: CaptureMode = "file",
  ): Promise<Result<void, EkweError>> {
    if (this.isStartingParams) return err(EkweError.AUDIO_RECORD_FAIL);
    this.isStartingParams = true;
    this.onAutoStopCallback = null;

    if (this.isRecording()) {
      logger.info(
        "AudioCapture: Already recording, stopping before restart...",
      );
      await this.stopRecording().catch(() => {});
    }

    try {
      const permResult = await this.checkPermission();
      if (!permResult.ok || !permResult.value) {
        this.isStartingParams = false;
        return err(EkweError.PERMISSION_MIC);
      }

      this.currentSessionId = sessionId;
      this.currentMeteringData = [];
      this.currentMode = mode;
      this.onAutoStopCallback = onAutoStop ?? null;

      if (isAndroid) {
        const rawCacheDir = Paths?.cache?.uri;
        if (!rawCacheDir) {
          logger.error("[AudioCapture] Paths.cache.uri is undefined/falsy");
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
        const cacheDir = rawCacheDir;
        const outputPath = `${cacheDir}ekwe_recording_${sessionId}.ogg`;
        if (typeof EkweNative.startAudioRecording !== "function") {
          logger.error(
            "[AudioCapture] EkweNative.startAudioRecording is not a function",
          );
          this.isStartingParams = false;
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
        let startResult;
        try {
          startResult = await EkweNative.startAudioRecording(
            outputPath,
            16000,
            mode === "live",
          );
        } catch (nativeErr) {
          logger.error("[AudioCapture] startAudioRecording threw:", nativeErr);
          this.isStartingParams = false;
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
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
        // iOS uses native AVAudioEngine for both file and live modes
        const cacheDir = Paths.cache.uri;
        const outputPath = `${cacheDir}ekwe_recording_${sessionId}.ogg`;
        const startResult = await EkweNative.startAudioRecording(
          outputPath,
          16000,
          mode === "live",
        );
        if (!startResult.success) {
          logger.error(
            "AudioCapture: AVAudioEngine start failed:",
            startResult.error,
          );
          this.isStartingParams = false;
          return err(EkweError.AUDIO_RECORD_FAIL);
        }
        this.currentRecordingPath = outputPath;
      }

      // Subscribe to native Opus packets (live mode) and VAD silence (both modes)
      if (mode === "live") {
        this.opusPacketSub = EkweNative.addListener(
          "onOpusPacket",
          (event: { packet: string; rms: number }) => {
            const binaryString = atob(event.packet);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const opusPacket: OpusPacket = { data: bytes.buffer, sessionId };
            this.opusPacketListeners.forEach((l) => l(opusPacket));
          },
        );
      }
      if (typeof EkweNative.addListener !== "function") {
        logger.error(
          "[AudioCapture] EkweNative.addListener is not a function — native module broken?",
        );
        this.isStartingParams = false;
        return err(EkweError.AUDIO_RECORD_FAIL);
      }
      this.vadSilenceSub = EkweNative.addListener("onVadSilence", () => {
        try {
          if (this.onAutoStopCallback) {
            this.onAutoStopCallback();
          }
        } catch (e) {
          logger.error("[AudioCapture] VAD silence callback error:", e);
        }
      });

      this.notifyStatusListeners("started");

      if (this.amplitudeRafId) cancelAnimationFrame(this.amplitudeRafId);

      const pollAmplitude = (): void => {
        const globalObj = globalThis as unknown as {
          ekweNativeGetAmplitude?: () => number;
        };
        if (typeof globalObj.ekweNativeGetAmplitude === "function") {
          const val = globalObj.ekweNativeGetAmplitude();
          this.currentMeteringData.push(val);
          this.notifyListeners(val);
        }
        this.amplitudeRafId = requestAnimationFrame(pollAmplitude);
      };
      this.amplitudeRafId = requestAnimationFrame(pollAmplitude);

      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);

      this.isStartingParams = false;
      return ok(undefined);
    } catch {
      this.opusPacketSub?.remove();
      this.opusPacketSub = null;
      this.vadSilenceSub?.remove();
      this.vadSilenceSub = null;
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

    this.opusPacketSub?.remove();
    this.opusPacketSub = null;
    this.vadSilenceSub?.remove();
    this.vadSilenceSub = null;
    this.onAutoStopCallback = null;

    if (this.amplitudeRafId) {
      cancelAnimationFrame(this.amplitudeRafId);
      this.amplitudeRafId = null;
    }

    try {
      const result = await EkweNative.stopAudioRecording();
      if (!result.success) {
        this.currentSessionId = null;
        this.currentMeteringData = [];
        this.notifyStatusListeners("stopped");
        return err(EkweError.AUDIO_RECORD_FAIL);
      }
      const uri = this.currentRecordingPath ?? "";
      const durationMs = result.durationMs;
      const waveform = result.waveform;
      this.currentRecordingPath = null;
      this.currentSessionId = null; // MUST clear before notify

      this.notifyStatusListeners("stopped");

      const recordingResult: RecordingResult = {
        uri,
        durationMs,
        sessionId,
        meteringData: [...this.currentMeteringData],
        ...(waveform !== undefined ? { waveform } : {}),
      };

      this.currentSessionId = null;
      this.currentMeteringData = [];

      if (isAndroid) {
        await releaseAudioEffects();
      }

      triggerHaptic(Haptics.NotificationFeedbackType.Success);
      return ok(recordingResult);
    } catch {
      this.currentSessionId = null;
      this.currentMeteringData = [];
      this.notifyStatusListeners("stopped");
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }

  async cancelRecording(): Promise<Result<string | null, EkweError>> {
    const path: string | null = this.currentRecordingPath;
    this.onAutoStopCallback = null;

    this.opusPacketSub?.remove();
    this.opusPacketSub = null;
    this.vadSilenceSub?.remove();
    this.vadSilenceSub = null;

    if (this.amplitudeRafId) {
      cancelAnimationFrame(this.amplitudeRafId);
      this.amplitudeRafId = null;
    }

    try {
      if (isAndroid || isIOS) {
        if (this.currentSessionId) {
          await EkweNative.stopAudioRecording();
          this.currentRecordingPath = null;
        }
      }
      this.notifyStatusListeners("stopped");
    } catch {
      // Ignore errors during cancel
    }

    this.currentSessionId = null;
    this.currentMeteringData = [];
    this.notifyListeners(0);

    if (isAndroid) {
      await releaseAudioEffects();
    }

    // Delete temp file
    if (path) {
      try {
        await EkweNative.deleteFile(path);
      } catch {
        // best-effort cleanup
      }
    }

    return ok(null);
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
    return this.currentSessionId !== null;
  }

  addListener(callback: (amplitude: number) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  addOpusPacketListener(callback: (packet: OpusPacket) => void): () => void {
    this.opusPacketListeners.push(callback);
    return () => {
      this.opusPacketListeners = this.opusPacketListeners.filter(
        (l) => l !== callback,
      );
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
