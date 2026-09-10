import { CLIENT_ABORTED, Env } from "../core/types";
import { logger } from "../core/logger";

export function getRandomInt(max: number): number {
  // Guard: max <= 0 would make `threshold` NaN and `value < NaN` false forever,
  // turning the rejection loop below into an infinite loop.
  if (!Number.isInteger(max) || max <= 0) return NaN;
  // Rejection sampling: `% max` is biased whenever 2^32 % max != 0 (and even
  // 32-bit getRandomValues has slight bias per the Web Crypto spec). A 1-in-2
  // rejection bound keeps expected draws < 2 while removing the bias entirely.
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

/** Cache for key → hash lookups. Bounded LRU cache (max 1000). */
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

export interface RotateKeysDetailedResult {
  /** First 2xx response, or null if no key succeeded. */
  response: Response | null;
  /**
   * Status code of the terminal non-2xx attempt when rotation stopped without
   * a 2xx (either a 5xx early-stop or the last failed key before the pool was
   * exhausted). Null when rotation stopped for another reason (no key pool,
   * all keys blacklisted, or execution threw for every key).
   *
   * Callers use this to distinguish "provider is hard-down" (5xx) from
   * "every key exhausted / unauthorized" (429/403) when deciding whether to
   * disable a provider for the rest of the day.
   */
  lastStatus: number | null;
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

  const array = new Uint32Array(keys.length);
  crypto.getRandomValues(array);
  const idx = keys.map((_, i) => i).sort((a, b) => array[a] - array[b]);
  const shuffled = idx.map((i) => keys[i]);

  let lastStatus: number | null = null;

  for (const key of shuffled) {
    if (signal.aborted) {
      // The combined attempt signal (AbortSignal.any) aborts for two reasons:
      // the client hung up (reason is an AbortError-style DOMException) or the
      // per-attempt timeout fired (AbortSignal.timeout aborts with a
      // "TimeoutError" DOMException). A timeout must NOT masquerade as a client
      // abort — that would kill the whole failover chain for one slow provider.
      // Stop this rotation and let the pipeline try the next provider with a
      // fresh attempt budget.
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
      // A single key failing must not abort rotation for the remaining keys.
      // Expected during provider failover (timeouts, aborts) — warn only.
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
      // Provider-side failure: every remaining key will 5xx too, and each
      // attempt costs the full timeout latency. Fail fast instead of cycling
      // through the whole pool.
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

/**
 * Rotation wrapper for callers that only need the first 2xx response.
 * See {@link rotateKeysDetailed} for the status-aware variant.
 */
export async function rotateKeys(
  env: Env,
  prefix: string,
  execute: (key: string) => Promise<Response>,
  signal: AbortSignal,
): Promise<Response | null> {
  const { response } = await rotateKeysDetailed(env, prefix, execute, signal);
  return response;
}
