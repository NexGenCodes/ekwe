import { mmkv } from "@/services/mmkv";

/**
 * Supabase-compatible async storage wrapper around the encrypted MMKV instance.
 * MMKV is synchronous internally; Promises are returned for Supabase's
 * SupportedStorage interface. Auth hydration is near-instant at boot.
 */
export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    return mmkv.getString(key) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    mmkv.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    mmkv.remove(key);
  },
};
