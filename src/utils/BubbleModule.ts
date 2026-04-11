import EkweNative from '../../modules/ekwe-native';

import { EkweError } from '@/constants/errors';
import { Result, ok, err } from '@/types/Result';

interface SavedPosition {
  x: number;
  y: number;
}

export const BubbleNative = {
  async hasOverlayPermission(): Promise<boolean> {
    try {
      return await EkweNative.hasOverlayPermission();
    } catch (e) {
      console.warn('[BubbleModule] hasOverlayPermission error:', e);
      return false;
    }
  },

  async requestOverlayPermission(): Promise<void> {
    try {
      await EkweNative.requestOverlayPermission();
    } catch (e) {
      console.warn('[BubbleModule] requestOverlayPermission error:', e);
    }
  },

  async startBubbleService(): Promise<Result<void, EkweError>> {
    try {
      await EkweNative.startBubbleService();
      return ok(undefined);
    } catch {
      return err(EkweError.PERMISSION_OVERLAY);
    }
  },

  async stopBubbleService(): Promise<void> {
    try {
      await EkweNative.stopBubbleService();
    } catch (e) {
      console.warn('[BubbleModule] stopBubbleService error:', e);
    }
  },

  async getSavedPosition(): Promise<SavedPosition | null> {
    try {
      const pos = await EkweNative.getSavedPosition();
      return pos;
    } catch {
      return null;
    }
  },

  async savePosition(x: number, y: number): Promise<void> {
    try {
      await EkweNative.savePosition(x, y);
    } catch (e) {
      console.warn('[BubbleModule] savePosition error:', e);
    }
  },

  async updateVisibility(visible: boolean): Promise<void> {
    try {
      await EkweNative.updateBubbleVisibility(visible);
    } catch (e) {
      console.warn('[BubbleModule] updateVisibility error:', e);
    }
  },

  async updateState(
    mode: 'RECORD' | 'MAGIC' | 'IDLE',
    data?: string,
  ): Promise<void> {
    try {
      await EkweNative.updateBubbleState(mode, data);
    } catch (e) {
      console.warn('[BubbleModule] updateState error:', e);
    }
  },

  async requestMediaProjection(): Promise<void> {
    try {
      await EkweNative.requestMediaProjection();
    } catch (e) {
      console.warn('[BubbleModule] requestMediaProjection error:', e);
    }
  },

  async stopAudioCapture(): Promise<void> {
    try {
      await EkweNative.stopAudioCapture();
    } catch (e) {
      console.warn('[BubbleModule] stopAudioCapture error:', e);
    }
  },

  async showFloatingCard(
    transcription: string,
    translation: string,
  ): Promise<void> {
    try {
      await EkweNative.showFloatingCard(transcription, translation);
    } catch (e) {
      console.warn('[BubbleModule] showFloatingCard error:', e);
    }
  },

  async resolveContentUri(uri: string): Promise<string | null> {
    try {
      return await EkweNative.resolveContentUri(uri);
    } catch (e) {
      console.warn('[BubbleModule] resolveContentUri error:', e);
      return null;
    }
  },
};
