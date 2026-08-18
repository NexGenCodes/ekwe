import { requireNativeModule, type NativeModule } from "expo";

import type {
  AudioEffectsResult,
  OpusTranscodeResult,
  DecodeToWavResult,
  DecodeToCafResult,
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

  // --- Authoritative device theme (Android only) ---
  // Reads the *resolved* system night mode from the OS (handles auto/scheduled),
  // so the share overlay never shows a stale Appearance cache. Returns "light" | "dark".
  getSystemTheme(): string;

  // --- Audio Effects ---
  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;

  // --- Audio Conversion ---
  transcodeToOpusWithWaveform(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<OpusTranscodeResult>;

  // --- Decode-to-WAV (iOS: AVPlayer can't play Ogg Opus) ---
  decodeAudioToWav(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<DecodeToWavResult>;

  // --- Decode-to-CAF (iOS: Opus-in-CAF avoids the WAV round-trip) ---
  decodeAudioToCaf(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<DecodeToCafResult>;

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
