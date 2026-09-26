import { CLIENT_ABORTED, type Env, type Tier } from "@/core/types";
import { logger } from "@/core/logger";
import { recordProviderAttempt } from "@/utils/analytics";
import { abortableDelay } from "@/utils/fetch";

/**
 * An attempt at or above this is logged at warn with `slow: true`, so provider
 * latency regressions surface on their own instead of hiding in the info feed.
 */
const SLOW_ATTEMPT_MS = 3_000;

export function classifyProviderError(error: unknown): ProviderErrorClass {
  if (error instanceof Error && error.message === CLIENT_ABORTED)
    return "client";
  const name = error instanceof Error ? error.name : "";
  const msg = error instanceof Error ? error.message : String(error);
  const text = `${name} ${msg}`.toLowerCase();

  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("deadline exceeded")
  )
    return "timeout";
  if (
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  )
    return "rate-limit";
  if (
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("529") ||
    text.includes("bad gateway") ||
    text.includes("service unavailable") ||
    text.includes("internal server error") ||
    text.includes("upstream")
  )
    return "server";
  if (
    text.includes("fetch failed") ||
    text.includes("failed to fetch") ||
    text.includes("network") ||
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("socket") ||
    text.includes("und_err") ||
    text.includes("broken pipe")
  )
    return "network";
  return "unknown";
}

export function isRetryableErrorClass(klass: ProviderErrorClass): boolean {
  return (
    klass === "timeout" ||
    klass === "network" ||
    klass === "rate-limit" ||
    klass === "server"
  );
}

export function jitteredBackoffMs(capMs: number): number {
  if (!Number.isFinite(capMs) || capMs <= 0) return 0;
  return Math.floor(Math.random() * Math.min(capMs, 200));
}

export type ProviderErrorClass =
  "timeout" | "network" | "rate-limit" | "server" | "client" | "unknown";

export interface ProviderFailoverConfig<T> {
  providers: readonly string[];
  signal: AbortSignal;
  totalMs: number;
  route: string;
  env?: Env;
  tier?: Tier;
  attemptTimeoutMs?: (provider: string, remainingMs: number) => number;
  shouldSkip?: (provider: string, index: number) => boolean | Promise<boolean>;
  onTrying?: (provider: string, remainingMs: number) => void;
  invoke: (provider: string, attemptSignal: AbortSignal) => Promise<T | null>;
  handleAttempt: (
    provider: string,
    result: T | null,
  ) => boolean | Promise<boolean>;
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
    if (shouldSkip && (await shouldSkip(provider, i))) {
      if (env) {
        void recordProviderAttempt(
          env,
          route,
          provider,
          "skip",
          0,
          "",
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
        if (signal.aborted) {
          throw new Error(CLIENT_ABORTED);
        }
        const attemptLatencyMs = Date.now() - attemptStart;
        if (await handleAttempt(provider, result)) {
          // A success that still ate a large slice of the budget is the signal
          // worth paging on, and it is invisible at info level once it is
          // averaged into the routine provider chatter. Flag it so slow calls
          // can be pulled out on their own.
          const slow = attemptLatencyMs >= SLOW_ATTEMPT_MS;
          const line =
            `[${route}] ${provider} ok in ${attemptLatencyMs}ms` +
            (attempt > 1 ? ` (attempt ${attempt})` : "") +
            (slow ? " SLOW" : "");
          const fields = {
            attemptLatencyMs,
            attempt,
            remainingMs: attemptRemaining,
            ...(slow ? { slow: true } : {}),
          };
          if (slow) logger.warn(line, fields);
          else logger.info(line, fields);
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
        break;
      } catch (e: unknown) {
        if (signal.aborted) throw new Error(CLIENT_ABORTED, { cause: e });
        if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
        const failLatencyMs = Date.now() - attemptStart;
        const errorClass = classifyProviderError(e);
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
          : isRetryableErrorClass(classifyProviderError(e));
        if (!retryable) break;

        const backoff = jitteredBackoffMs(
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
