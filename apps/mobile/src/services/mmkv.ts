import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createMMKV, MMKV } from "react-native-mmkv";

const ENCRYPTION_KEY_ID = "ekwe-mmkv-key";

const OLD_FLAT_KEY_ID = "ekwe-key-storage";

/**
 * In-memory stand-in used until initializeMMKV() resolves. Writes made before
 * the encrypted store is ready are ephemeral and are migrated on init — they
 * are never persisted to disk in plaintext. This guarantees the MMKV
 * encryption key is the only thing required to decrypt session data and it
 * never leaves SecureStore.
 */
class InMemoryMMKV {
  private map = new Map<string, string>();

  set(key: string, value: string | boolean | number): void {
    this.map.set(key, String(value));
  }

  getString(key: string): string | undefined {
    return this.map.get(key);
  }

  getBoolean(key: string): boolean | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    return v === "true";
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  getAllKeys(): string[] {
    return [...this.map.keys()];
  }

  clearAll(): void {
    this.map.clear();
  }
}

let _storage: MMKV | InMemoryMMKV = new InMemoryMMKV();
let _ready = false;
let _upgradePromise: Promise<void> | null = null;

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
        // One-time legacy migration from the pre-SecureStore plaintext cache.
        const oldKeyStorage = createMMKV({ id: OLD_FLAT_KEY_ID });
        key = oldKeyStorage.getString(ENCRYPTION_KEY_ID) ?? null;
        oldKeyStorage.clearAll();
      } catch {
        key = null;
      }
    }

    if (!key) {
      const keyBytes = Crypto.getRandomValues(new Uint8Array(16));
      key = Array.from(keyBytes, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      await SecureStore.setItemAsync(ENCRYPTION_KEY_ID, key);
    }

    const encrypted = createMMKV({
      id: "ekwe-storage",
      encryptionKey: key,
    });

    // Migrate any ephemeral in-memory writes made before init completed.
    const keys = _storage.getAllKeys();
    for (const k of keys) {
      const val = _storage.getString(k);
      if (val !== undefined) encrypted.set(k, val);
    }

    _storage = encrypted;
    _ready = true;
  })();

  return _upgradePromise;
}

export const mmkv = new Proxy<MMKV>({} as MMKV, {
  get(_, prop): unknown {
    const value = (_storage as MMKV)[prop as keyof MMKV];
    return typeof value === "function"
      ? value.bind(_storage as MMKV)
      : value;
  },
  set(_, prop, value): boolean {
    (_storage as unknown as Record<string, unknown>)[prop as string] = value;
    return true;
  },
});
