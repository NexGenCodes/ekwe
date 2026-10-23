import { Env } from "@/core/types";
import { hexEncode } from "@/utils/keys";

const SIGN_BYTES = 16;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return hexEncode(bytes.buffer as ArrayBuffer).slice(0, SIGN_BYTES * 2);
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length !== SIGN_BYTES * 2 || !/^[a-f0-9]+$/.test(hex)) return null;
  const out = new Uint8Array(SIGN_BYTES);
  for (let i = 0; i < SIGN_BYTES; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function signingSecret(env: Env): string {
  if (!env.SPEECH_URL_SECRET) throw new Error("no signing secret configured");
  return env.SPEECH_URL_SECRET;
}

/** `<cacheKey>.<sig>`, where sig is a truncated HMAC over the cache key. */
export async function signSpeechUrl(
  env: Env,
  cacheKey: string,
): Promise<string> {
  const sig = toHex(await hmac(signingSecret(env), cacheKey));
  return `${cacheKey}.${sig}`;
}

export async function verifySpeechUrl(
  env: Env,
  signed: string,
): Promise<string | null> {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const cacheKey = signed.slice(0, dot);
  const provided = fromHex(signed.slice(dot + 1));
  if (!provided) return null;

  const expected = (await hmac(signingSecret(env), cacheKey)).subarray(
    0,
    SIGN_BYTES,
  );
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  return diff === 0 ? cacheKey : null;
}
