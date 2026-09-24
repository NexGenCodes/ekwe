import { requireNativeModule, type NativeModule } from "expo";

import type {
  AudioEffectsResult,
  OpusTranscodeResult,
  DecodeToWavResult,
  RemuxToCafResult,
  AudioRecordingResult,
  StartRecordingResult,
} from "./EkweNative.types";

declare global {
  /**
   * Installed by nativeInstallJsi() during module init.
   * Returns the current RMS value [0,1] from the capture controller,
   * or 0 if no recording is active.
   */
  var ekweNativeGetAmplitude: (() => number) | undefined;
}

declare class EkweNativeModule extends NativeModule<{
  onOpusPacket: (event: { packet: string; rms: number }) => void;
  onVadSilence: (event: Record<string, never>) => void;
}> {
  deleteFile(uri: string): Promise<void>;
  writeSharedFile(fileName: string, content: string): Promise<boolean>;

  // --- Echo / Loader ---
  dismissEcho(): Promise<void>;
  dismissNativeLoader(): Promise<void>;

  // --- Content URI Resolution ---
  resolveContentUri(uri: string, maxAudioBytes: number): Promise<string | null>;

  // --- iOS Voice Session (voiceChat mode → built-in NS, AEC, AGC) ---
  configureVoiceSession(): Promise<void>;

  // --- Authoritative device theme ---
  // Reads the *resolved* system night mode from the OS (handles auto/scheduled),
  // so the share overlay never shows a stale Appearance cache. Returns "light" | "dark".
  // Android resolves synchronously; iOS reads the main-thread UI traits, so there
  // its return is a Promise.
  getSystemTheme(): string | Promise<string>;

  // --- Update channel (store vs sideload) ---
  // Authoritative answer to "who installed Ekwe". This is the forward-compat
  // gate for the in-app "New version" update badge:
  //
  //   "store"     → installed from a real distribution store (Play, Amazon,
  //                 Galaxy, AppGallery, Xiaomi, Oppo, Vivo…). The store manages
  //                 the native binary itself, so the badge auto-hides the day
  //                 we publish — no code change, no store-day rework.
  //   "sideload"  → adb install / direct APK. The binary can't self-update, so
  //                 the badge + APK download are exactly right.
  //
  // Android reads the OS installer package (version-aware: installSourceInfo on
  // API 30+, installerPackageName before). iOS has no installer concept — the
  // binary only ever reaches a device through App Store / TestFlight — so it
  // always answers "store", which keeps the resolver platform-symmetric with
  // zero Platform.OS branching in JS.
  getInstallerSource(): string | Promise<string>;

  // --- Audio Effects ---
  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;

  // --- Audio Conversion ---
  transcodeToOpusWithWaveform(
    inputPath: string,
    outputPath: string,
    maxBytes: number,
    options?: { frameMs?: number },
  ): Promise<OpusTranscodeResult>;

  // --- Decode-to-WAV (iOS: AVPlayer can't play Ogg Opus) ---
  decodeAudioToWav(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<DecodeToWavResult>;

  // --- Remux-to-CAF (iOS: Opus-in-CAF avoids the WAV round-trip) ---
  remuxToCaf(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<RemuxToCafResult>;

  // --- AudioRecord (dual-path: file or live) ---
  startAudioRecording(
    outputPath: string,
    sampleRate: number,
    isLive?: boolean,
  ): Promise<StartRecordingResult>;

  stopAudioRecording(): Promise<AudioRecordingResult>;

  // --- Direct content:// → Ogg Opus (no temp file, Android only) ---
  resolveAndTranscodeToOpus(
    contentUri: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<OpusTranscodeResult>;
}

export default requireNativeModule<EkweNativeModule>("EkweNative");
