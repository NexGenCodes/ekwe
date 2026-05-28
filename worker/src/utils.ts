import { Env, Tier } from './types';
import { logger } from './logger';

// ─── Constants ────────────────────────────────────────────────────
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB hard limit
export const MAX_WORDS_PER_SECOND = 6;
export const MIN_WORDS_PER_SECOND = 0.15;
export const TIMEOUT_FAST = 15_000;
export const TIMEOUT_SLOW = 25_000;

// ─── Known Whisper hallucination patterns ─────────────────────────
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^thanks?\s+(for\s+)?watching/i,
  /^thank\s+you\s+for\s+watching/i,
  /^(please\s+)?(subscribe|like\s+and\s+subscribe)/i,
  /^(music|applause|laughter|silence|blank audio)\s*\.?$/i,
  /^\[.*\]\s*$/, // "[Music]", "[Applause]"
  /^\.+$/, // "..." or "....."
  /(.{5,})\1{2,}/, // same phrase repeated 3+ times
  /^(you|he|she|they|we|i)\s*$/i, // single pronoun garbage
  /^(the|a|an)\s*$/i, // single article garbage
];

// ─── Core Helpers ─────────────────────────────────────────────────

export function sanitizeKey(key: unknown): string {
  if (typeof key !== 'string' || !key) return '';
  return key.replace(/[^\x20-\x7E]/g, '').trim();
}

export function getUserAgent(): string {
  const randomUserAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 12; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36',
  ];
  return randomUserAgents[Math.floor(Math.random() * randomUserAgents.length)];
}

export function getClientHeaders(request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (request) {
    const forwardedFor = request.headers.get('X-Forwarded-For');
    const realIp = request.headers.get('X-Real-IP');
    if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
    if (realIp) headers['X-Real-IP'] = realIp;
  }

  return headers;
}

/**
 * Dual-mode hallucination detection:
 * 1. Pattern-based — always runs, catches known Whisper garbage
 * 2. WPS-based — runs when duration is available from provider
 */
export function isHallucination(text: string, durationMs?: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  if (durationMs && durationMs > 0) {
    const words = trimmed.split(/\s+/).filter((w) => w.length > 0).length;
    const durationSeconds = durationMs / 1000;
    const wps = words / durationSeconds;
    if (wps > MAX_WORDS_PER_SECOND) return true;
    if (words > 3 && wps < MIN_WORDS_PER_SECOND) return true;
  }

  return false;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  clientSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onClientAbort = (): void => controller.abort();
  if (clientSignal) {
    if (clientSignal.aborted) {
      controller.abort();
    } else {
      clientSignal.addEventListener('abort', onClientAbort);
    }
  }

  try {
    return await fetch(url.toString(), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);
  }
}

export async function abortableDelay(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error('CLIENT_ABORTED');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('CLIENT_ABORTED'));
    };
    signal.addEventListener('abort', onAbort);
  });
}

// ─── Generic Key Rotation ─────────────────────────────────────────

export async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generic key rotation with KV-based blacklisting.
 * @param env - Worker environment
 * @param prefix - Env key prefix (e.g. 'GROQ_KEY_', 'DEEPGRAM_KEY_', 'GLADIA_KEY_')
 * @param execute - Callback that makes the API call with the key
 * @param abortedCheck - Client abort check
 */
export async function rotateKeys(
  env: Env,
  prefix: string,
  execute: (key: string) => Promise<Response>,
  signal: AbortSignal,
): Promise<Response | null> {
  const namespace = prefix.replace(/_$/, '').toLowerCase(); // 'GROQ_KEY_' → 'groq_key'
  const keys = Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => sanitizeKey(env[k]))
    .filter((k) => k.length > 10);

  const shuffled = [...keys].sort(() => Math.random() - 0.5);

  for (const key of shuffled) {
    if (signal.aborted) throw new Error('CLIENT_ABORTED');

    const keyHash = await hashKey(key);
    if (await env.EKWE_KV.get(`blacklist:${namespace}:${keyHash}`)) continue;

    const res = await execute(key);

    // 2xx → success, return immediately
    if (res.ok) return res;

    if (res.status === 429) {
      await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, 'true', {
        expirationTtl: 60,
      });
      logger.info(`[${namespace}] Key blacklisted for 60s (429)`);
      // Anti-ban Jitter: Delay 50ms - 150ms before trying the next key
      const jitterMs = Math.floor(Math.random() * 100) + 50;
      await new Promise((r) => setTimeout(r, jitterMs));
      continue;
    }

    // Permanently dead key: invalid credentials or account suspended → blacklist 24h
    if (res.status === 401 || res.status === 403) {
      await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, 'true', {
        expirationTtl: 86400,
      });
      logger.warn(
        `[${namespace}] Key permanently blacklisted for 24h (${res.status})`,
      );
      continue;
    }

    // 400 can signal a permanent org/account restriction (e.g. Groq organization_restricted).
    // Clone the response so we can inspect the body without consuming it.
    if (res.status === 400) {
      try {
        const body = await res.clone().text();
        const PERMANENT_CODES = [
          'organization_restricted',
          'invalid_api_key',
          'account_deactivated',
          'account_suspended',
        ];
        if (PERMANENT_CODES.some((code) => body.includes(code))) {
          await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, 'true', {
            expirationTtl: 86400,
          });
          logger.warn(
            `[${namespace}] Key permanently blacklisted for 24h (400 permanent error)`,
          );
        }
      } catch (err) {
        logger.warn(
          `[${namespace}] Failed to parse error body for blacklist check`,
          { error: err },
        );
      }
      continue;
    }

    // Everything else (500, 502, 503, etc.) → try next key without blacklisting
    continue;
  }

  return null;
}

// ─── Transaction Ledger Helpers ─────────────────────────────────────

export interface PreflightResponse {
  allowed: boolean;
  tier_active: Tier;
  is_fallback: boolean;
  transactions_used: number;
  reason?: string;
  cooldown_remaining?: number;
}

export async function checkPreflight(
  env: Env,
  userId: string,
  requestedTier: Tier,
): Promise<PreflightResponse> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      allowed: false,
      tier_active: requestedTier,
      is_fallback: false,
      transactions_used: 0,
      reason: 'PREFLIGHT_CONFIG_ERROR',
    };
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_preflight`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId, p_tier: requestedTier }),
    });

    if (res.ok) {
      return (await res.json()) as PreflightResponse;
    }
  } catch (err) {
    logger.error('[preflight] check failed, failing closed', { error: err });
  }
  return {
    allowed: false,
    tier_active: requestedTier,
    is_fallback: false,
    transactions_used: 0,
    reason: 'PREFLIGHT_UNAVAILABLE',
  };
}

export async function postflightDeduction(
  env: Env,
  userId: string,
  cost: number,
): Promise<Record<string, unknown> | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/postflight_deduction`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_user_id: userId, p_cost: cost }),
      },
    );
    if (res.ok) {
      return (await res.json()) as Record<string, unknown>;
    }
  } catch {
    logger.error('[postflight] deduction failed');
  }
  return null;
}

// ─── Streaming Helpers ───────────────────────────────────────────

/**
 * Resolves the first env var matching a numbered prefix (e.g. GLADIA_KEY_1).
 */
export function getFirstKey(env: Env, prefix: string): string | null {
  for (let i = 1; i <= 10; i++) {
    const key = env[`${prefix}${i}`] as string | undefined;
    if (key && typeof key === 'string') return key;
  }
  return null;
}

/**
 * Creates a WebSocket with a connection timeout.
 * Resolves with the WebSocket on open, or null on error/timeout.
 */
export function connectWithTimeout(
  url: string,
  protocols?: string | string[],
): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url, protocols);
      const timer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          resolve(null);
        }
      }, 5000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Bi-directionally relays messages between two WebSockets.
 * Handles binary/text messages and close propagation.
 * Returns a cleanup function to stop relaying.
 */
export function relayWebSockets(
  a: WebSocket,
  b: WebSocket,
): () => void {
  let aClosed = false;
  let bClosed = false;
  let aCleanup: (() => void) | null = null;
  let bCleanup: (() => void) | null = null;

  function closeBoth(): void {
    if (!aClosed) { try { a.close(); } catch { /* ignore */ } }
    if (!bClosed) { try { b.close(); } catch { /* ignore */ } }
  }

  const onAMessage = (event: MessageEvent): void => {
    if (bClosed) return;
    try { b.send(event.data); } catch { /* ignore */ }
  };
  const onAClose = (): void => {
    aClosed = true;
    if (!bClosed) {
      bClosed = true;
      try { b.close(); } catch { /* ignore */ }
    }
  };
  const onAError = (): void => { onAClose(); };

  const onBMessage = (event: MessageEvent): void => {
    if (aClosed) return;
    try { a.send(event.data); } catch { /* ignore */ }
  };
  const onBClose = (): void => {
    bClosed = true;
    if (!aClosed) {
      aClosed = true;
      try { a.close(); } catch { /* ignore */ }
    }
  };
  const onBError = (): void => { onBClose(); };

  a.addEventListener('message', onAMessage);
  a.addEventListener('close', onAClose);
  a.addEventListener('error', onAError);

  b.addEventListener('message', onBMessage);
  b.addEventListener('close', onBClose);
  b.addEventListener('error', onBError);

  aCleanup = (): void => {
    a.removeEventListener('message', onAMessage);
    a.removeEventListener('close', onAClose);
    a.removeEventListener('error', onAError);
  };
  bCleanup = (): void => {
    b.removeEventListener('message', onBMessage);
    b.removeEventListener('close', onBClose);
    b.removeEventListener('error', onBError);
  };

  return () => {
    aCleanup?.();
    bCleanup?.();
    closeBoth();
  };
}
