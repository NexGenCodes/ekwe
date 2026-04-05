import { NativeModule, requireNativeModule } from 'expo';

import type { BubblePosition, AudioEffectsResult } from './EkweNative.types';

declare class EkweNativeModule extends NativeModule {
  // Bubble Overlay
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  startBubbleService(): Promise<void>;
  stopBubbleService(): Promise<void>;
  getSavedPosition(): Promise<BubblePosition>;
  savePosition(x: number, y: number): Promise<void>;

  // Audio Effects
  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;
}

export default requireNativeModule<EkweNativeModule>('EkweNative');
