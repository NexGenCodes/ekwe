import { requireNativeModule } from 'expo';
import type { NativeModule } from 'expo-modules-core';

import type { BubblePosition, AudioEffectsResult } from './EkweNative.types';

declare class EkweNativeModule extends NativeModule<{
  onBubbleStateChanged: (event: { state: string; reason?: string }) => void;
  onForegroundAppChanged: (event: { packageName: string }) => void;
}> {
  // Bubble Overlay
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  startBubbleService(): Promise<void>;
  stopBubbleService(): Promise<void>;
  getSavedPosition(): Promise<BubblePosition>;
  savePosition(x: number, y: number): Promise<void>;
  updateBubbleVisibility(visible: boolean): Promise<void>;
  updateBubbleState(
    mode: 'RECORD' | 'MAGIC' | 'IDLE',
    data?: string,
  ): Promise<void>;
  showFloatingCard(transcription: string, translation: string): Promise<void>;

  // Content URI Resolution (Android)
  resolveContentUri(uri: string): Promise<string | null>;

  // Accessibility & Detection
  isAccessibilityEnabled(): Promise<boolean>;
  requestAccessibilityPermission(): Promise<void>;


  // System Audio Capture
  requestMediaProjection(): Promise<void>;
  stopAudioCapture(): Promise<void>;

  // Audio Effects
  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;
}

export default requireNativeModule<EkweNativeModule>('EkweNative');
