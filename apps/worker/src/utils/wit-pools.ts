import type { Env } from "@/core/types";
import { logger } from "@/core/logger";

interface SecretStoreBindingLike {
  get(): Promise<string | null>;
}

const POOL_BINDING_RE = /^WIT_POOL_\d+$/;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface WitPoolCacheEntry {
  loadedAt: number;
  maps: Map<string, string>[];
}

const witPoolCaches = new WeakMap<Env, WitPoolCacheEntry>();

async function collectPoolMaps(env: Env): Promise<Map<string, string>[]> {
  const names = Object.keys(env)
    .filter((k) => POOL_BINDING_RE.test(k))
    .sort();

  const maps: Map<string, string>[] = [];
  for (const name of names) {
    const binding = env[name] as SecretStoreBindingLike | undefined;
    if (!binding || typeof binding.get !== "function") continue;

    let raw: string | null;
    try {
      raw = await binding.get();
    } catch (err) {
      logger.warn("[wit-pools] Failed to read binding", {
        binding: name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const map = new Map<string, string>();
      for (const [lang, key] of Object.entries(parsed)) {
        if (typeof key === "string" && key.trim()) {
          map.set(lang, key.trim());
        }
      }
      maps.push(map);
    } catch (err) {
      logger.warn("[wit-pools] Invalid JSON in binding", {
        binding: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return maps;
}

async function loadWitPools(env: Env): Promise<Map<string, string>[]> {
  const now = Date.now();
  const cached = witPoolCaches.get(env);
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.maps;
  }
  const maps = await collectPoolMaps(env);
  witPoolCaches.set(env, { loadedAt: now, maps });
  return maps;
}

export async function getWitSecretKey(
  env: Env,
  targetLang: string,
  baseLang: string,
): Promise<string | null> {
  const direct = env[`WIT_KEY_${targetLang}`] ?? env[`WIT_KEY_${baseLang}`];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const maps = await loadWitPools(env);
  for (const map of maps) {
    const key = map.get(targetLang) ?? map.get(baseLang);
    if (key) return key;
  }
  return null;
}

export async function loadWitPoolKeys(env: Env): Promise<string[]> {
  const maps = await loadWitPools(env);
  const keys: string[] = [];
  for (const map of maps) {
    for (const key of map.values()) {
      if (key.length > 10) keys.push(key);
    }
  }
  return keys;
}
