import {
  AudioModule,
  AudioQuality,
  setIsAudioActiveAsync,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
} from "expo-audio";
import type { AudioRecorder, RecordingOptions } from "expo-audio";
import * as Haptics from "expo-haptics";

import { PLAN_LIMITS } from "@/constants/billing";
import { logger, isIOS } from "@/utils";
import { releaseAudioEffects } from "@/utils/AudioEffectsModule";

type PermissionStatus = "Granted" | "Denied" | "Undetermined" | "Restricted";

const RECORDING_OPTIONS: Partial<RecordingOptions> = {
  extension: ".flac",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  android: {
    outputFormat: "default",
    audioEncoder: "default",
    extension: ".wav",
    sampleRate: 16000,
  },
  ios: {
    outputFormat: "flac",
    audioQuality: AudioQuality.MAX,
    extension: ".flac",
    sampleRate: 16000,
  },
  web: {
    mimeType: "audio/wav",
    bitsPerSecond: 256000,
  },
};

class AudioService {
  private static instance: AudioService;
  private recorder: AudioRecorder | null = null;

  private constructor() {}

  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }

  public async checkPermission(): Promise<PermissionStatus> {
    const { status } = await getRecordingPermissionsAsync();
    return status as unknown as PermissionStatus;
  }

  public async requestPermission(): Promise<PermissionStatus> {
    const { status } = await requestRecordingPermissionsAsync();
    return status as unknown as PermissionStatus;
  }

  public async initialize(): Promise<void> {
    if (this.recorder) return;

    if (isIOS) {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          interruptionMode: "doNotMix",
        });
      } catch (e) {
        logger.warn("AudioSession configuration failed:", e);
      }
    }

    // eslint-disable-next-line import/namespace -- AudioRecorder is a property on NativeAudioModule
    this.recorder = new AudioModule.AudioRecorder(RECORDING_OPTIONS);
  }

  public async startRecording(maxDurationMs?: number): Promise<void> {
    const status = await this.checkPermission();
    if (status !== "Granted") {
      const result = await this.requestPermission();
      if (result !== "Granted") throw new Error("Permission denied");
    }

    await this.initialize();
    if (!this.recorder) throw new Error("Recorder not initialized");

    await this.recorder.prepareToRecordAsync();

    const WAV_THRESHOLD_MS = PLAN_LIMITS.pro.dictationDurationMs;
    const useWav = !maxDurationMs || maxDurationMs <= WAV_THRESHOLD_MS;

    this.recorder.record(
      useWav && maxDurationMs
        ? { forDuration: maxDurationMs / 1000 }
        : undefined,
    );

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  public async stopRecording(): Promise<{ path: string; duration: number }> {
    if (!this.recorder || !this.recorder.isRecording) {
      throw new Error("Recorder not initialized or not recording");
    }

    await this.recorder.stop();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const path = this.recorder.uri || "";
    const duration = this.recorder.currentTime * 1000;

    await setIsAudioActiveAsync(false);

    await releaseAudioEffects();

    return { path, duration };
  }

  public async purgeCache(): Promise<void> {
    // Cache purging is handled by expo-audio internally
  }

  public getMetering(): number {
    if (!this.recorder) return -160;
    return this.recorder.getStatus().metering ?? -160;
  }

  public async setPlaybackMode(): Promise<void> {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      interruptionMode: "duckOthers",
    });
  }

  public isRecording(): boolean {
    return this.recorder?.isRecording || false;
  }

  public async cleanup(): Promise<void> {
    if (this.recorder) {
      if (this.recorder.isRecording) {
        try {
          await this.recorder.stop();
        } catch {
          // Ignore errors during cleanup
        }
      }
      this.recorder = null;
    }
    await setIsAudioActiveAsync(false);
    releaseAudioEffects();
  }
}

export default AudioService.getInstance();
