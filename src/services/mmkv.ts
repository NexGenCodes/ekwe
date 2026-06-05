import * as Crypto from "expo-crypto";
import { createMMKV } from "react-native-mmkv";

const ENCRYPTION_KEY_ID = "ekwe_mmkv_key";

/**
 * Unencrypted MMKV instance used ONLY to store the AES encryption key
 * for the main encrypted store. Keeps boot fast (sync, no keychain calls).
 * OS-level file protection still applies (MODE_PRIVATE / NSFileProtection).
 */
const keyStorage = createMMKV({ id: "ekwe-key-storage" });

/**
 * Retrieves (or creates) the AES encryption key from the unencrypted
 * key-storage MMKV instance. Runs synchronously once at boot.
 */
function getOrCreateEncryptionKey(): string {
  let key = keyStorage.getString(ENCRYPTION_KEY_ID);
  if (!key) {
    key = Crypto.randomUUID();
    keyStorage.set(ENCRYPTION_KEY_ID, key);
  }
  return key;
}

const encryptionKey = getOrCreateEncryptionKey();

/**
 * Encrypted MMKV instance — single source of truth for all fast key-value
 * storage (Supabase tokens, sync timestamps, session records, settings).
 */
export const mmkv = createMMKV({
  id: "ekwe-storage",
  encryptionKey,
});

/**
 * MMKV constructor config — exported so Legend State's MMKV plugin can
 * create its own instance backed by the same encrypted store.
 */
export const mmkvConfig = {
  id: "ekwe-storage",
  encryptionKey,
};
