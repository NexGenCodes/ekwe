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
  /^\[.*\]\s*$/,                       // "[Music]", "[Applause]"
  /^\.+$/,                             // "..." or "....."
  /(.{5,})\1{2,}/,                     // same phrase repeated 3+ times
  /^(you|he|she|they|we|i)\s*$/i,      // single pronoun garbage
  /^(the|a|an)\s*$/i,                  // single article garbage
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
    'Mozilla/5.0 (Linux; Android 12; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36'
  ];
  return randomUserAgents[Math.floor(Math.random() * randomUserAgents.length)];
}

export function getEvasionHeaders(request: Request): Record<string, string> {
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '1.1.1.1';
  return {
    'User-Agent': getUserAgent(),
    'X-Forwarded-For': clientIp,
    'X-Real-IP': clientIp,
    'CF-Connecting-IP': clientIp
  };
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
    const words = trimmed.split(/\s+/).filter(w => w.length > 0).length;
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

  const onClientAbort = () => controller.abort();
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

export async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('CLIENT_ABORTED');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('CLIENT_ABORTED'));
    };
    signal.addEventListener('abort', onAbort);
  });
}

// ─── Generic Key Rotation ─────────────────────────────────────────

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
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
    .filter(k => k.startsWith(prefix))
    .map(k => sanitizeKey(env[k]))
    .filter(k => k.length > 10);

  const shuffled = [...keys].sort(() => Math.random() - 0.5);

  for (const key of shuffled) {
    if (signal.aborted) throw new Error('CLIENT_ABORTED');

    const keyHash = await hashKey(key);
    if (await env.EKWE_KV.get(`blacklist:${namespace}:${keyHash}`)) continue;

    const res = await execute(key);

    if (res.status === 429) {
      await env.EKWE_KV.put(`blacklist:${namespace}:${keyHash}`, 'true', { expirationTtl: 60 });
      logger.info(`[${namespace}] Key blacklisted for 60s (429)`);
      // Anti-ban Jitter: Delay 50ms - 150ms before trying the next key
      const jitterMs = Math.floor(Math.random() * 100) + 50;
      await new Promise(r => setTimeout(r, jitterMs));
      continue;
    }

    if (res.status >= 500 || res.status === 401) continue;

    return res;
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

export async function checkPreflight(env: Env, userId: string, requestedTier: Tier): Promise<PreflightResponse> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { allowed: true, tier_active: requestedTier, is_fallback: false, transactions_used: 0 };
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_preflight`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_user_id: userId, p_tier: requestedTier })
    });

    if (res.ok) {
      return await res.json() as PreflightResponse;
    }
  } catch (err) {
    logger.error('[preflight] check failed', { error: err });
  }
  return { allowed: true, tier_active: requestedTier, is_fallback: false, transactions_used: 0 };
}

export async function postflightDeduction(env: Env, userId: string, cost: number): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/postflight_deduction`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_user_id: userId, p_cost: cost })
    });
  } catch {
    // Silently fail to not interrupt user flow
  }
}
