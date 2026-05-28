import * as SecureStore from "expo-secure-store";

import { logger } from "@/utils";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainService: "ekwe_secure_storage",
};

export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(key, secureStoreOptions);
    } catch {
      // Keystore corrupted or locked: purge it to prevent infinite logout loops
      await SecureStore.deleteItemAsync(key, secureStoreOptions).catch(
        () => {},
      );
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(key, value, secureStoreOptions);
    } catch (e) {
      logger.error("[secureStorage] Failed to set item:", e);
      // Fallback: purge if corrupted
      await SecureStore.deleteItemAsync(key, secureStoreOptions).catch(
        () => {},
      );
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key, secureStoreOptions);
    } catch (e) {
      logger.error("[secureStorage] Failed to remove item:", e);
    }
  },
};
