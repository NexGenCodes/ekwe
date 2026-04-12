import { requireNativeModule } from 'expo';
import type { NativeModule } from 'expo-modules-core';
import type { BubblePosition, AudioEffectsResult, FloatingState } from './EkweNative.types';

declare class EkweNativeModule extends NativeModule<{
  // Unified window lifecycle events
  onStateChanged: (event: { state: FloatingState; previousState: FloatingState; reason?: string }) => void;
  onIntentQueued: (event: { audioPath: string; sourceApp: string }) => void;
  onAppForeground: (event: {}) => void;
  onAppBackground: (event: {}) => void;
  // Retained from old API
  onForegroundAppChanged: (event: { packageName: string }) => void;
}> {
  // --- Bubble ---
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  showBubble(x: number, y: number): Promise<void>;
  hideBubble(): Promise<void>; // (Optional synonym for dismissBubble)
  dismissBubble(): Promise<void>;
  expandBubble(): Promise<void>;
  collapseBubble(): Promise<void>;
  updateBubbleMode(mode: 'RECORD' | 'MAGIC' | 'IDLE', data?: string): Promise<void>;

  // --- Overlay ---
  showOverlay(audioPath: string, sourceApp: string): Promise<void>;
  setOverlayHeight(heightPx: number, animated: boolean): Promise<void>;
  dismissOverlay(): Promise<void>;

  // --- Echo / Loader ---
  dismissEcho(): Promise<void>;
  dismissNativeLoader(): Promise<void>;

  // --- State ---
  getWindowState(): Promise<FloatingState>;

  // --- Position (retained) ---
  getSavedPosition(): Promise<BubblePosition>;
  savePosition(x: number, y: number): Promise<void>;

  // --- Content URI Resolution (retained) ---
  resolveContentUri(uri: string): Promise<string | null>;

  // --- Accessibility (retained) ---
  isAccessibilityEnabled(): Promise<boolean>;
  requestAccessibilityPermission(): Promise<void>;

  // --- System Audio (retained) ---
  requestMediaProjection(): Promise<void>;
  stopAudioCapture(): Promise<void>;

  // --- Audio Effects (retained) ---
  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;
}

export default requireNativeModule<EkweNativeModule>('EkweNative');
