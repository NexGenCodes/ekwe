import { createMMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';

const mmkv = createMMKV({
  id: 'ekwe-store',
  mode: 'multi-process',
});

export const mmkvStorage: StateStorage = {
  getItem: (name: string): string | null => {
    const value = mmkv.getString(name);
    return value ?? null;
  },
  setItem: (name: string, value: string): void => {
    mmkv.set(name, value);
  },
  removeItem: (name: string): void => {
    mmkv.remove(name);
  },
};
