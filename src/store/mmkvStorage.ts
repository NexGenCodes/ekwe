import { createMMKV } from 'react-native-mmkv';

export const mmkv = createMMKV({
  id: 'ekwe-store',
  mode: 'multi-process',
});

export const mmkvStorage = {
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
