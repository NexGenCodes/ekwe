import { CLIENT_ABORTED, Env } from "../types";
import { logger } from "../logger";

export function getRandomInt(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
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

export async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return hexEncode(buf);
}

export async function hashBytes(buffer: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", buffer);
  return hexEncode(buf);
}

export async function rotateKeys(
  env: Env,
  prefix: string,
  execute: (key: string) => Promise<Response>,
  signal: AbortSignal,
): Promise<Response | null> {
  const namespace = prefix.replace(/_$/, "").toLowerCase();
  const keys = Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => sanitizeKey(env[k]))
    .filter((k) => k.length > 10);

  const array = new Uint32Array(keys.length);
  crypto.getRandomValues(array);
  const idx = keys.map((_, i) => i).sort((a, b) => array[a] - array[b]);
  const shuffled = idx.map((i) => keys[i]);

  for (const key of shuffled) {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);

    const keyHash = await hashKey(key);
    if (await env.EKWE_KV.get(`blacklist:${namespace}:${keyHash}`)) continue;

    let res: Response;
    try {
      res = await execute(key);
    } catch (err) {
      // A single key failing must not abort rotation for the remaining keys.
      logger.error("[keys] Rotation attempt failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (res.ok) return res;

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

    continue;
  }

  return null;
}
