import { EkweError } from 'src/constants/errors';
import { Result, ok, err } from 'src/types/Result';

import EkweNative from '../../modules/ekwe-native';

interface SavedPosition {
  x: number;
  y: number;
}

export const BubbleNative = {
  async hasOverlayPermission(): Promise<boolean> {
    try {
      return await EkweNative.hasOverlayPermission();
    } catch {
      return false;
    }
  },

  async requestOverlayPermission(): Promise<void> {
    try {
      await EkweNative.requestOverlayPermission();
    } catch {
      /* ignore */
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
    } catch {
      /* ignore */
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
    } catch {
      /* ignore */
    }
  },
};
