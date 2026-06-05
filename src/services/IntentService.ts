import { Linking } from 'react-native';
import { isAndroid } from '@/utils';

import EkweNative from '../../modules/ekwe-native';

import logger from '@/utils/logger';

export const IntentService = {
  resolveToFileUri: async (rawUri: string): Promise<string | null> => {
    if (isAndroid && rawUri.startsWith('content://')) {
      return EkweNative.resolveContentUri(rawUri);
    }
    return rawUri;
  },

  dismissNativeLoader: (): void => {
    if (isAndroid) {
      EkweNative.dismissNativeLoader();
    }
  },

  updateBubbleMode: (mode: 'IDLE' | 'MAGIC' | 'RECORD'): void => {
    try {
      EkweNative?.updateBubbleMode?.(mode);
    } catch (err) {
      logger.warn('[IntentService] updateBubbleMode failed', err);
    }
  },

  dismissAndRedirect: (): void => {
    EkweNative.dismissEcho();
    Linking.openURL('ekwe://');
  },

  dismissEcho: (): void => {
    if (isAndroid) {
      EkweNative.dismissEcho();
    }
  },
};
