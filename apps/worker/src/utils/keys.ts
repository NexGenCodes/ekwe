import { CLIENT_ABORTED, Env } from "@/core/types";
import { logger } from "@/core/logger";
import { loadWitPoolKeys } from "@/utils/wit-pools";

export function getRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) return NaN;
  const threshold = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const value = arr[0];
    if (value < threshold) return value % max;
  }
}

export function sanitizeKey(key: unknown): string {
  if (typeof key !== "string" || !key) return "";
  return key.replace(/[^\x20-\x7E]/g, "").trim();
}

export function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const keyHashCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;
const MAX_CACHE_KEY_LENGTH = 512;

export async function hashKey(key: string): Promise<string> {
  if (key.length > MAX_CACHE_KEY_LENGTH) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key),
    );
    return hexEncode(buf);
  }
  const cached = keyHashCache.get(key);
  if (cached) {
    keyHashCache.delete(key);
    keyHashCache.set(key, cached);
    return cached;
  }
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const hash = hexEncode(buf);

  if (keyHashCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = keyHashCache.keys().next().value;
    if (oldestKey !== undefined) {
      keyHashCache.delete(oldestKey);
    }
  }

  keyHashCache.set(key, hash);
  return hash;
}

export async function hashBytes(buffer: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", buffer);
  return hexEncode(buf);
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)),
  ]);
  const aBuf = new Uint8Array(hashA);
  const bBuf = new Uint8Array(hashB);
  if (aBuf.length !== bBuf.length) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

export interface RotateKeysDetailedResult {
  response: Response | null;
  lastStatus: number | null;
}

/**
 * Usable keys for a provider, in random order so every session does not hammer
 * the first one until it rate-limits.
 */
export function providerKeys(env: Env, prefix: string): string[] {
  const keys = Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => sanitizeKey(env[k]))
    .filter((k) => k.length > 10);

  const order = new Uint32Array(keys.length);
  crypto.getRandomValues(order);
  return keys
    .map((k, i) => ({ k, r: order[i] }))
    .sort((a, b) => a.r - b.r)
    .map(({ k }) => k);
}

export async function rotateKeysDetailed(
  env: Env,
  prefix: string,
  execute: (key: string) => Promise<Response>,
  signal: AbortSignal,
): Promise<RotateKeysDetailedResult> {
  const namespace = prefix.replace(/_$/, "").toLowerCase();
  const keys = Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => sanitizeKey(env[k]))
    .filter((k) => k.length > 10);

  const candidates =
    prefix === "WIT_KEY_" ? [...keys, ...(await loadWitPoolKeys(env))] : keys;

  const array = new Uint32Array(candidates.length);
  crypto.getRandomValues(array);
  const idx = candidates.map((_, i) => i).sort((a, b) => array[a] - array[b]);
  const shuffled = idx.map((i) => candidates[i]);

  let lastStatus: number | null = null;

  for (const key of shuffled) {
    if (signal.aborted) {
      if (
        (signal.reason as { name?: string } | undefined)?.name !==
        "TimeoutError"
      ) {
        throw new Error(CLIENT_ABORTED);
      }
      return { response: null, lastStatus };
    }

    const keyHash = await hashKey(key);
    if (await env.EKWE_KV.get(`blacklist:${namespace}:${keyHash}`)) continue;

    let res: Response;
    try {
      res = await execute(key);
    } catch (err) {
      logger.warn("[keys] Rotation attempt failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (res.ok) return { response: res, lastStatus: null };

    lastStatus = res.status;

    if (res.status === 429) {
      await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, "true", {
        expirationTtl: 60,
      });
      const jitterMs = getRandomInt(100) + 50;
      await new Promise((r) => setTimeout(r, jitterMs));
      continue;
    }

    if (res.status === 401 || res.status === 402 || res.status === 403) {
      await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, "true", {
        expirationTtl: 86400,
      });
      continue;
    }

    if (res.status === 400) {
      try {
        const body = await res.clone().text();
        const PERMANENT_CODES = [
          "organization_restricted",
          "invalid_api_key",
          "account_deactivated",
          "account_suspended",
        ];
        if (PERMANENT_CODES.some((code) => body.includes(code))) {
          await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, "true", {
            expirationTtl: 86400,
          });
        }
      } catch {
        // ignore parse errors
      }
      continue;
    }

    if (res.status >= 500) {
      logger.warn("[keys] Provider returned 5xx, stopping rotation early", {
        status: res.status,
        namespace,
      });
      return { response: null, lastStatus: res.status };
    }

    continue;
  }

  return { response: null, lastStatus };
}

export async function rotateKeys(
  env: Env,
  prefix: string,
  execute: (key: string) => Promise<Response>,
  signal: AbortSignal,
): Promise<Response | null> {
  const { response } = await rotateKeysDetailed(env, prefix, execute, signal);
  return response;
}
