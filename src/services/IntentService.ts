import { Platform, Linking } from 'react-native';

import EkweNative from '../../modules/ekwe-native';

export const IntentService = {
  resolveToFileUri: async (rawUri: string): Promise<string | null> => {
    if (Platform.OS === 'android' && rawUri.startsWith('content://')) {
      return EkweNative.resolveContentUri(rawUri);
    }
    return rawUri;
  },

  dismissNativeLoader: (): void => {
    if (Platform.OS === 'android') {
      EkweNative.dismissNativeLoader();
    }
  },

  updateBubbleMode: (mode: 'IDLE' | 'MAGIC' | 'RECORD'): void => {
    try {
      EkweNative?.updateBubbleMode?.(mode);
    } catch {}
  },

  dismissAndRedirect: (resetShareIntent: (clear: boolean) => void): void => {
    if (Platform.OS === 'android') {
      EkweNative.dismissEcho();
      Linking.openURL('ekwe://');
    } else {
      resetShareIntent(true);
      Linking.openURL('ekwe://');
    }
  },

  dismissEcho: (resetShareIntent: (clear: boolean) => void): void => {
    if (Platform.OS === 'android') {
      EkweNative.dismissEcho();
    } else {
      resetShareIntent(true);
    }
  },
};
