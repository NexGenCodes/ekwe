import { mmkv } from "@/services/mmkv";

export const supabaseStorage = {
  getItem: async (key: string): Promise<string | null> =>
    mmkv.getString(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    mmkv.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    mmkv.remove(key);
  },
};
