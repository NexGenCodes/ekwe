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
      console.warn('[BubbleNative] hasOverlayPermission error:', e);
      return false;
    }
  },

  async requestOverlayPermission(): Promise<void> {
    try {
      await EkweNative.requestOverlayPermission();
    } catch (e) {
      console.warn('[BubbleNative] requestOverlayPermission error:', e);
    }
  },

  async showBubble(x: number = 100, y: number = 100): Promise<Result<void, EkweError>> {
    try {
      await EkweNative.showBubble(x, y);
      return ok(undefined);
    } catch {
      return err(EkweError.PERMISSION_OVERLAY);
    }
  },

  async dismissBubble(): Promise<void> {
    try {
      await EkweNative.dismissBubble();
    } catch (e) {
      console.warn('[BubbleNative] dismissBubble error:', e);
    }
  },

  async expandBubble(): Promise<void> {
    try {
      await EkweNative.expandBubble();
    } catch (e) {
      console.warn('[BubbleNative] expandBubble error:', e);
    }
  },

  async collapseBubble(): Promise<void> {
    try {
      await EkweNative.collapseBubble();
    } catch (e) {
      console.warn('[BubbleNative] collapseBubble error:', e);
    }
  },

  async showOverlay(audioPath: string, sourceApp: string): Promise<Result<void, EkweError>> {
    try {
      await EkweNative.showOverlay(audioPath, sourceApp);
      return ok(undefined);
    } catch (e) {
      console.warn('[BubbleNative] showOverlay error:', e);
      return err(EkweError.PROCESSOR_FAIL);
    }
  },

  async dismissOverlay(): Promise<void> {
    try {
      await EkweNative.dismissOverlay();
    } catch (e) {
      console.warn('[BubbleNative] dismissOverlay error:', e);
    }
  },

  async getSavedPosition(): Promise<SavedPosition | null> {
    try {
      return await EkweNative.getSavedPosition();
    } catch {
      return null;
    }
  },

  async savePosition(x: number, y: number): Promise<void> {
    try {
      await EkweNative.savePosition(x, y);
    } catch (e) {
      console.warn('[BubbleNative] savePosition error:', e);
    }
  },

  async updateState(
    mode: 'RECORD' | 'MAGIC' | 'IDLE',
    data?: string,
  ): Promise<void> {
    try {
      await EkweNative.updateBubbleMode(mode, data);
    } catch (e) {
      console.warn('[BubbleNative] updateState error:', e);
    }
  },

  async requestMediaProjection(): Promise<void> {
    try {
      await EkweNative.requestMediaProjection();
    } catch (e) {
      console.warn('[BubbleNative] requestMediaProjection error:', e);
    }
  },

  async stopAudioCapture(): Promise<void> {
    try {
      await EkweNative.stopAudioCapture();
    } catch (e) {
      console.warn('[BubbleNative] stopAudioCapture error:', e);
    }
  },

  async resolveContentUri(uri: string): Promise<string | null> {
    try {
      return await EkweNative.resolveContentUri(uri);
    } catch (e) {
      console.warn('[BubbleNative] resolveContentUri error:', e);
      return null;
    }
  },

  async getWindowState(): Promise<string> {
    try {
      return await EkweNative.getWindowState();
    } catch (e) {
      console.warn('[BubbleNative] getWindowState error:', e);
      return 'IDLE';
    }
  }
};
