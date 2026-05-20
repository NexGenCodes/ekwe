import { setItem, getItem, deleteItem } from 'react-native-sensitive-info';

import { logger } from '@/utils';

// Configuration for sensitive-info v6 (Nitro)
const secureStoreConfig = {
  service: 'ekwe_secure_storage',
  accessControl: 'none' as const, // Use 'none' to avoid biometric prompts on every app boot/auth check
};

export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const item = await getItem(key, secureStoreConfig);
      return item?.value || null;
    } catch {
      // Keystore corrupted or locked: purge it to prevent infinite logout loops
      await deleteItem(key, secureStoreConfig).catch(() => {});
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await setItem(key, value, secureStoreConfig);
    } catch (e) {
      logger.error('[secureStorage] Failed to set item:', e);
      // Fallback: purge if corrupted
      await deleteItem(key, secureStoreConfig).catch(() => {});
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await deleteItem(key, secureStoreConfig);
    } catch (e) {
      logger.error('[secureStorage] Failed to remove item:', e);
    }
  },
};
