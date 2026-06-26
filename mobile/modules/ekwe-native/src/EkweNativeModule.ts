import { requireNativeModule } from 'expo';
import type { NativeModule } from 'expo-modules-core';

import type {
  BubblePosition,
  AudioEffectsResult,
  FloatingState,
  ExtractWavAndWaveformResult,
  AudioRecordingResult,
  StartRecordingResult,
} from './EkweNative.types';

declare class EkweNativeModule extends NativeModule<{
  onStateChanged: (event: {
    state: FloatingState;
    previousState: FloatingState;
    reason?: string;
  }) => void;
  onIntentQueued: (event: { audioPath: string; sourceApp: string }) => void;
  onAppForeground: (event: {}) => void;
  onAppBackground: (event: {}) => void;
  onForegroundAppChanged: (event: { packageName: string }) => void;
}> {
  // --- Bubble ---
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  showBubble(x: number, y: number): Promise<void>;
  hideBubble(): Promise<void>;
  dismissBubble(): Promise<void>;
  expandBubble(): Promise<void>;
  collapseBubble(): Promise<void>;
  updateBubbleMode(
    mode: 'RECORD' | 'MAGIC' | 'IDLE',
    data?: string,
  ): Promise<void>;
  deleteFile(uri: string): Promise<void>;

  // --- Overlay ---
  showOverlay(audioPath: string, sourceApp: string): Promise<void>;
  setOverlayHeight(heightPx: number, animated: boolean): Promise<void>;
  dismissOverlay(): Promise<void>;

  // --- Echo / Loader ---
  dismissEcho(): Promise<void>;
  dismissNativeLoader(): Promise<void>;

  // --- State ---
  getWindowState(): Promise<FloatingState>;

  // --- Position ---
  getSavedPosition(): Promise<BubblePosition>;
  savePosition(x: number, y: number): Promise<void>;

  // --- Content URI Resolution ---
  resolveContentUri(uri: string): Promise<string | null>;

  // --- Accessibility ---
  isAccessibilityEnabled(): Promise<boolean>;
  requestAccessibilityPermission(): Promise<void>;

  // --- System Audio ---
  requestMediaProjection(): Promise<void>;
  stopAudioCapture(): Promise<void>;

  // --- iOS Voice Session (voiceChat mode → built-in NS, AEC, AGC) ---
  configureVoiceSession(): Promise<void>;

  // --- AudioRecord metering (Android) ---
  getRecordingAmplitude(): Promise<number>;

  // --- Audio Effects ---
  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;

  // --- Audio Conversion ---
  extractWavAndWaveform(
    inputPath: string,
    outputPath: string,
  ): Promise<ExtractWavAndWaveformResult>;

  // --- AudioRecord (Android) / stub (iOS) ---
  startAudioRecording(
    outputPath: string,
    sampleRate: number,
  ): Promise<StartRecordingResult>;

  stopAudioRecording(): Promise<AudioRecordingResult>;

  // --- Direct content:// → FLAC (no temp file, Android only) ---
  resolveAndConvertToFlac(
    contentUri: string,
    outputPath: string,
  ): Promise<ExtractWavAndWaveformResult>;
}

export default requireNativeModule<EkweNativeModule>('EkweNative');
