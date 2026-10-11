import { CLIENT_ABORTED, type Env, type Tier } from "@/core/types";
import { logger } from "@/core/logger";
import { recordProviderAttempt } from "@/utils/analytics";
import { abortableDelay } from "@/utils/fetch";
import { classifyError, isRetryableClass } from "@/core/provider-errors";
import type { SkipReason } from "@/core/route-eligibility";

export type { ProviderErrorClass } from "@/core/provider-errors";

/**
 * An attempt at or above this is logged at warn with `slow: true`, so provider
 * latency regressions surface on their own instead of hiding in the info feed.
 */
const SLOW_ATTEMPT_MS = 3_000;

/**
 * Exponential with full jitter. A flat 0–200ms window was nominally jitter but
 * behaved like a constant 100ms pause, synchronising the herd.
 */
export function jitteredBackoffMs(attempt: number, capMs: number): number {
  if (!Number.isFinite(capMs) || capMs <= 0) return 0;
  const ceiling = Math.min(capMs, 250 * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

export interface ProviderFailoverConfig<T> {
  providers: readonly string[];
  signal: AbortSignal;
  totalMs: number;
  route: string;
  env?: Env;
  tier?: Tier;
  attemptTimeoutMs?: (provider: string, remainingMs: number) => number;
  /**
   * Returns a reason rather than a boolean so it reaches telemetry: a skip
   * nobody can see is indistinguishable from a provider nobody configured.
   */
  shouldSkip?: (
    provider: string,
    index: number,
  ) => SkipReason | null | Promise<SkipReason | null>;
  onTrying?: (provider: string, remainingMs: number) => void;
  invoke: (provider: string, attemptSignal: AbortSignal) => Promise<T | null>;
  handleAttempt: (
    provider: string,
    result: T | null,
  ) => boolean | Promise<boolean>;
  /** Called after `handleAttempt` declines, so bad results stay visible. */
  onRejectedResult?: (provider: string, result: T | null) => void;
  onAttemptError?: (
    provider: string,
    error: unknown,
    attempt: number,
  ) => void | Promise<void>;
  shouldRetryOnError?: (
    provider: string,
    error: unknown,
    attempt: number,
  ) => boolean;
  maxRetries?: number;
  minRetryBudgetMs?: number;
}

export async function runProviderFailover<T>(
  config: ProviderFailoverConfig<T>,
): Promise<T | null> {
  const {
    providers,
    signal,
    totalMs,
    route,
    env,
    tier,
    attemptTimeoutMs,
    shouldSkip,
    onTrying,
    invoke,
    handleAttempt,
    onRejectedResult,
    onAttemptError,
    shouldRetryOnError,
    maxRetries = 1,
    minRetryBudgetMs = 1_250,
  } = config;

  const pipelineStart = Date.now();

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const remainingMs = totalMs - (Date.now() - pipelineStart);
    if (remainingMs <= 0) break;

    const skipReason = shouldSkip ? await shouldSkip(provider, i) : null;
    if (skipReason) {
      logger.info(`[${route}] Skipping ${provider} (${skipReason})`);
      if (env) {
        void recordProviderAttempt(
          env,
          route,
          provider,
          "skip",
          0,
          skipReason,
          0,
          tier ?? "",
        );
      }
      continue;
    }

    let attempt = 0;
    for (;;) {
      attempt++;
      const attemptRemaining = totalMs - (Date.now() - pipelineStart);
      if (attemptRemaining <= 0) break;

      const attemptStart = Date.now();
      try {
        if (signal.aborted) throw new Error(CLIENT_ABORTED);
        if (onTrying) {
          onTrying(provider, attemptRemaining);
        } else if (attempt > 1) {
          logger.info(`[${route}] Retrying ${provider} (attempt ${attempt})`, {
            remainingMs: attemptRemaining,
          });
        } else {
          logger.info(`[${route}] Trying ${provider}`);
        }

        const providerMs = attemptTimeoutMs
          ? attemptTimeoutMs(provider, attemptRemaining)
          : attemptRemaining;
        const timeoutMs =
          Number.isFinite(providerMs) && providerMs > 0
            ? Math.min(providerMs, attemptRemaining)
            : attemptRemaining;
        const attemptSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(timeoutMs),
        ]);

        const result = await invoke(provider, attemptSignal);
        if (signal.aborted) throw new Error(CLIENT_ABORTED);
        const attemptLatencyMs = Date.now() - attemptStart;

        if (await handleAttempt(provider, result)) {
          const slow = attemptLatencyMs >= SLOW_ATTEMPT_MS;
          const line =
            `[${route}] ${provider} ok in ${attemptLatencyMs}ms` +
            (attempt > 1 ? ` (attempt ${attempt})` : "") +
            (slow ? " SLOW" : "");
          if (slow) logger.warn(line, { attemptLatencyMs, slow: true });
          else logger.info(line, { attemptLatencyMs });
          if (env) {
            void recordProviderAttempt(
              env,
              route,
              provider,
              "success",
              attemptLatencyMs,
              "",
              attempt,
              tier ?? "",
            );
          }
          return result;
        }

        // Recorded here: a declined result used to record nothing, so a
        // provider returning garbage looked identical to one never configured.
        onRejectedResult?.(provider, result);
        if (env) {
          void recordProviderAttempt(
            env,
            route,
            provider,
            "rejected",
            attemptLatencyMs,
            result === null ? "empty-result" : "unusable-result",
            attempt,
            tier ?? "",
          );
        }
        // Not retried on the same provider: it answered, and an identical
        // request will not produce a different answer.
        break;
      } catch (e: unknown) {
        if (signal.aborted) throw new Error(CLIENT_ABORTED, { cause: e });
        if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;

        const failLatencyMs = Date.now() - attemptStart;
        const errorClass = classifyError(e);
        logger.error(
          `[${route}] ${provider} failed in ${failLatencyMs}ms (${errorClass})`,
          {
            attempt,
            attemptLatencyMs: failLatencyMs,
            ...(failLatencyMs >= SLOW_ATTEMPT_MS ? { slow: true } : {}),
            errorClass,
            error: e instanceof Error ? e.message : String(e),
            remainingMs: attemptRemaining,
          },
        );
        if (onAttemptError) {
          try {
            await onAttemptError(provider, e, attempt);
          } catch {
            /* health reporting must never take the request path down */
          }
        }
        if (env) {
          void recordProviderAttempt(
            env,
            route,
            provider,
            "failure",
            failLatencyMs,
            errorClass,
            attempt,
            tier ?? "",
          );
        }

        const afterFailRemaining = totalMs - (Date.now() - pipelineStart);
        if (attempt > maxRetries || afterFailRemaining < minRetryBudgetMs) {
          break;
        }
        const retryable = shouldRetryOnError
          ? shouldRetryOnError(provider, e, attempt)
          : isRetryableClass(errorClass);
        if (!retryable) break;

        const backoff = jitteredBackoffMs(
          attempt,
          Math.max(afterFailRemaining - minRetryBudgetMs, 0) + minRetryBudgetMs,
        );
        try {
          await abortableDelay(
            Math.min(backoff, afterFailRemaining - 100),
            signal,
          );
        } catch (delayErr) {
          if (delayErr instanceof Error && delayErr.message === CLIENT_ABORTED)
            throw delayErr;
        }
      }
    }
  }
  return null;
}
