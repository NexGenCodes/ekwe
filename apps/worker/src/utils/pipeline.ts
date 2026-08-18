import { CLIENT_ABORTED } from "../core/types";
import { logger } from "../core/logger";

/**
 * Provider failover loop shared by /transcribe, /translate and /tts.
 *
 * Each route used to inline the same skeleton: iterate providers in priority
 * order, respect an overall time budget, rethrow client aborts, log per-attempt
 * failures, and fall through to a 503 when everything fails. Route-specific
 * behavior (skip conditions, cache writes, billing, provider day-flags) lives
 * in the callbacks.
 *
 * Note: the streaming path (stream-do.ts) deliberately does NOT use this — its
 * loop has no time budget and swallows provider errors rather than rethrowing
 * CLIENT_ABORTED, so folding it in would force the helper to grow options for
 * its sake.
 */
export interface ProviderFailoverConfig<T> {
  /** Provider names, in priority order. */
  providers: readonly string[];
  signal: AbortSignal;
  /** Hard ceiling for the whole failover loop. */
  totalMs: number;
  /** Log prefix, e.g. "transcribe". */
  route: string;
  /**
   * Per-attempt timeout in ms, given the remaining budget. Defaults to the
   * remaining budget; a route can cap a single slow provider below that.
   */
  attemptTimeoutMs?: (provider: string, remainingMs: number) => number;
  /** Called before each attempt; return true to skip this provider. */
  shouldSkip?: (provider: string, index: number) => boolean | Promise<boolean>;
  /** Overrides the default `[route] Trying <provider>` log line. */
  onTrying?: (provider: string, remainingMs: number) => void;
  invoke: (provider: string, attemptSignal: AbortSignal) => Promise<T | null>;
  /**
   * Runs after each attempt with its result (null when the provider failed).
   * Return true to stop the pipeline with that result. Post-processing — KV
   * cache write, billing, provider day-flags, response — lives here.
   */
  handleAttempt: (
    provider: string,
    result: T | null,
  ) => boolean | Promise<boolean>;
}

/**
 * Runs the failover loop and returns the first accepted result, or null when
 * every provider failed or the budget ran out.
 */
export async function runProviderFailover<T>(
  config: ProviderFailoverConfig<T>,
): Promise<T | null> {
  const {
    providers,
    signal,
    totalMs,
    route,
    attemptTimeoutMs,
    shouldSkip,
    onTrying,
    invoke,
    handleAttempt,
  } = config;

  const pipelineStart = Date.now();
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const remainingMs = totalMs - (Date.now() - pipelineStart);
    if (remainingMs <= 0) break;
    if (shouldSkip && (await shouldSkip(provider, i))) continue;

    try {
      if (signal.aborted) throw new Error(CLIENT_ABORTED);
      if (onTrying) {
        onTrying(provider, remainingMs);
      } else {
        logger.info(`[${route}] Trying ${provider}`);
      }

      const providerMs = attemptTimeoutMs
        ? attemptTimeoutMs(provider, remainingMs)
        : remainingMs;
      // Sanity-clamp: a misbehaving callback (negative/zero/NaN) must never
      // feed AbortSignal.timeout an invalid delay. remainingMs is > 0 here
      // (checked at loop top), so this always yields a valid positive timeout.
      const timeoutMs =
        Number.isFinite(providerMs) && providerMs > 0
          ? Math.min(providerMs, remainingMs)
          : remainingMs;
      const attemptSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(timeoutMs),
      ]);

      const result = await invoke(provider, attemptSignal);
      if (await handleAttempt(provider, result)) return result;
    } catch (e: unknown) {
      if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
      logger.error(`[${route}] ${provider} failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return null;
}
