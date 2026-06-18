import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createMMKV, MMKV } from "react-native-mmkv";

const ENCRYPTION_KEY_ID = "ekwe-mmkv-key";

const OLD_FLAT_KEY_ID = "ekwe-key-storage";

/**
 * Boot MMKV — unencrypted, used only to cache the encryption key for sync boot.
 * On first launch, the key is fetched from SecureStore (async) and cached here.
 * On subsequent launches, the key is available synchronously, so the encrypted
 * MMKV can be created at module load time — before any component mounts.
 */
const bootStorage = createMMKV({ id: "ekwe-boot" });

let _storage: MMKV;
let _ready = false;
let _upgradePromise: Promise<void> | null = null;

// Try to load encryption key from boot cache (sync) — works on 2nd+ launches
const cachedKey = bootStorage.getString(ENCRYPTION_KEY_ID);

if (cachedKey) {
  _storage = createMMKV({ id: "ekwe-storage", encryptionKey: cachedKey });
  _ready = true;
} else {
  _storage = bootStorage;
}

export async function initializeMMKV(): Promise<void> {
  if (_ready) return;
  if (_upgradePromise) return _upgradePromise;

  _upgradePromise = (async (): Promise<void> => {
    let key: string | null = null;

    try {
      key = await SecureStore.getItemAsync(ENCRYPTION_KEY_ID);
    } catch {
      // Key missing or corrupted — will generate new one
    }

    if (!key) {
      try {
        const oldKeyStorage = createMMKV({ id: OLD_FLAT_KEY_ID });
        key = oldKeyStorage.getString(ENCRYPTION_KEY_ID) ?? null;
        oldKeyStorage.clearAll();
      } catch {
        key = null;
      }
    }

    if (!key) {
      const keyBytes = Crypto.getRandomValues(new Uint8Array(16));
      key = Array.from(keyBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, key);
    }

    // Cache the key in boot MMKV so future boots are sync
    bootStorage.set(ENCRYPTION_KEY_ID, key);

    const encrypted = createMMKV({
      id: "ekwe-storage",
      encryptionKey: key,
    });

    const keys = _storage.getAllKeys();
    for (const k of keys) {
      if (k === ENCRYPTION_KEY_ID) continue;
      const val = _storage.getString(k);
      if (val !== undefined) encrypted.set(k, val);
    }

    // Clear boot data (already migrated) but keep the cached encryption key
    const savedKey = bootStorage.getString(ENCRYPTION_KEY_ID);
    bootStorage.clearAll();
    if (savedKey) bootStorage.set(ENCRYPTION_KEY_ID, savedKey);

    _storage = encrypted;
    _ready = true;
  })();

  return _upgradePromise;
}

export const mmkv = new Proxy<MMKV>({} as MMKV, {
  get(_, prop): unknown {
    const value = _storage[prop as keyof MMKV];
    return typeof value === "function" ? value.bind(_storage) : value;
  },
  set(_, prop, value): boolean {
    (_storage as unknown as Record<string, unknown>)[prop as string] = value;
    return true;
  },
});
