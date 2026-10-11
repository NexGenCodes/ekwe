import { Env } from "@/core/types";
import { logger } from "@/core/logger";

export const HEALTH_TRIP_THRESHOLD = 3;
const HEALTH_OPEN_MS = 30_000;
const HEALTH_REOPEN_MS = 60_000;
const HEALTH_MEMO_TTL_MS = 15_000;
const HEALTH_COUNT_TTL_MS = 60_000;

const HEALTH_KEY_PREFIX = "health:";

interface HealthState {
  trippedAtEpochMs: number;
  failures: number;
  openMs: number;
}

interface MemoEntry {
  untilEpochMs: number;
  state: HealthState | null;
}

const healthMemo = new Map<string, MemoEntry>();

function healthKey(provider: string): string {
  return `${HEALTH_KEY_PREFIX}${provider}`;
}

function isStateOpen(state: HealthState | null, now: number): boolean {
  return !!state && now < state.trippedAtEpochMs + state.openMs;
}

async function readState(
  env: Env,
  provider: string,
): Promise<HealthState | null> {
  try {
    const raw = await env.EKWE_KV.get(healthKey(provider));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HealthState;
    return {
      trippedAtEpochMs: parsed.trippedAtEpochMs ?? 0,
      failures: parsed.failures ?? 0,
      openMs: parsed.openMs ?? HEALTH_OPEN_MS,
    };
  } catch {
    return null;
  }
}

async function writeState(
  env: Env,
  provider: string,
  state: HealthState,
): Promise<void> {
  try {
    const openRemainingMs = state.trippedAtEpochMs + state.openMs - Date.now();
    const ttlSeconds =
      openRemainingMs > 0
        ? Math.ceil(openRemainingMs / 1000) + 60
        : Math.ceil(HEALTH_COUNT_TTL_MS / 1000);

    await env.EKWE_KV.put(healthKey(provider), JSON.stringify(state), {
      expirationTtl: Math.max(1, ttlSeconds),
    });
  } catch {
    // Health writes must never break the request path.
  }
}

export function resetHealthMemo(): void {
  healthMemo.clear();
}

export function reportProviderNeutral(provider: string): void {
  const now = Date.now();
  const memo = healthMemo.get(provider);
  if (!memo || memo.untilEpochMs <= now) return;

  healthMemo.set(provider, {
    untilEpochMs: now + HEALTH_MEMO_TTL_MS,
    state: memo.state,
  });
}

export async function isProviderDegraded(
  env: Env,
  provider: string,
): Promise<boolean> {
  const now = Date.now();
  const memo = healthMemo.get(provider);
  if (memo && memo.untilEpochMs > now) return isStateOpen(memo.state, now);

  const state = await readState(env, provider);
  healthMemo.set(provider, {
    untilEpochMs: now + HEALTH_MEMO_TTL_MS,
    state,
  });
  return isStateOpen(state, now);
}

export async function reportProviderOutcome(
  env: Env,
  provider: string,
  ok: boolean,
): Promise<void> {
  const now = Date.now();
  const memo = healthMemo.get(provider);
  const memoFresh = !!memo && memo.untilEpochMs > now;

  if (ok) {
    const hadStress =
      memoFresh &&
      (isStateOpen(memo?.state ?? null, now) ||
        (memo?.state?.failures ?? 0) > 0);
    if (hadStress) {
      try {
        await env.EKWE_KV.delete(healthKey(provider));
      } catch {
        // Clearing best-effort; a stale trip self-expires via TTL anyway.
      }
      logger.info(`[health] "${provider}" circuit closed`);
    }
    healthMemo.set(provider, {
      untilEpochMs: now + HEALTH_MEMO_TTL_MS,
      state: null,
    });
    return;
  }

  let state = memoFresh ? (memo?.state ?? null) : null;
  if (!state) {
    state = await readState(env, provider);
  }
  const base: HealthState = state ?? {
    trippedAtEpochMs: 0,
    failures: 0,
    openMs: HEALTH_OPEN_MS,
  };
  base.failures += 1;

  const openNow = isStateOpen(base, now);
  const probeFailed = openNow && now >= base.trippedAtEpochMs + base.openMs;

  if (openNow || probeFailed) {
    base.trippedAtEpochMs = now;
    base.openMs =
      base.failures >= HEALTH_TRIP_THRESHOLD
        ? HEALTH_REOPEN_MS
        : HEALTH_OPEN_MS;
    await writeState(env, provider, base);
    logger.error(
      `[health] "${provider}" ${probeFailed ? "re" : ""}opened for ${base.openMs}ms`,
      { failures: base.failures },
    );
  } else if (base.failures >= HEALTH_TRIP_THRESHOLD) {
    base.trippedAtEpochMs = now;
    base.openMs = HEALTH_OPEN_MS;
    await writeState(env, provider, base);
    logger.error(`[health] "${provider}" tripped open for ${base.openMs}ms`, {
      failures: base.failures,
    });
  } else {
    await writeState(env, provider, base);
  }

  healthMemo.set(provider, {
    untilEpochMs: now + HEALTH_MEMO_TTL_MS,
    state: base,
  });
}
