/**
 * Pro-Level Network Utilities
 * Handles retries, backoff, timeouts, and offline fail-fast for robust
 * service connections.
 *
 * Offline semantics are centralized here: the moment the network store reports
 * a *definitive* disconnect, requests fail fast instead of burning a 30s
 * timeout chain on a device that obviously can't reach the server. "Unknown"
 * network state never blocks a request.
 */
import { WORKER_ERROR_CODES } from "@ekwe/shared";

import { EkweError } from "@/constants/errors";
import { supabase } from "@/services/supabase";
import { isDefinitelyOffline } from "@/store/network";
import { auth$, authActions } from "@/store/auth";
import logger from "@/utils/logger";

export interface RetryOptions {
  retries?: number;
  backoff?: number; // ms
  timeout?: number; // ms
  signal?: AbortSignal;
  /**
   * When true (default), an HTTP 5xx response is treated as retryable.
   * For expensive, stateful POSTs (transcribe/translate) the worker has
   * already tried every provider by the time it returns 5xx, so retrying
   * only burns provider budget a second time. Pass false to retry ONLY on
   * network-level failures (fetch threw).
   */
  retryOnHttpResponse?: boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  retries: 3,
  backoff: 1000,
  timeout: 30000, // 30s default
  retryOnHttpResponse: true,
};

/** Marker error thrown when the device is definitively offline. */
export class OfflineNetworkError extends Error {
  constructor() {
    super("Device is offline");
    this.name = "OfflineNetworkError";
  }
}

export const isOfflineNetworkError = (err: unknown): boolean =>
  err instanceof OfflineNetworkError;

/** Marker error thrown when a request exceeds the configured timeout. */
export class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

export const isTimeoutError = (err: unknown): boolean =>
  err instanceof TimeoutError;

/**
 * Single source for the worker base URL across every service. Missing config
 * returns "" so callers can branch on "not configured" exactly like before.
 */
export const getWorkerUrl = (): string =>
  process.env.EXPO_PUBLIC_WORKER_URL ?? "";

/**
 * Heals the Pro/Free divergence between the two sources of truth: the client
 * `auth$.isPro` (from the payment provider's status reconciliation) vs the
 * worker's tier, which it derives from `app_metadata.is_pro` in the *current*
 * Supabase JWT. The access token hook re-mints `is_pro` from user_subscriptions
 * on every new token, so a stale token can hold `is_pro: false` long after the
 * payment provider says Pro (the webhook → user_subscriptions update doesn't
 * touch an already-issued token).
 *
 * Refreshing the session once re-runs the hook and emits a token whose
 * `is_pro` matches user_subscriptions — fixing the worker's tier without the
 * user waiting out the old token's TTL. Only fires when the client already
 * believes the user is Pro, so a genuinely free user never burns a refresh on
 * every premium 403. Returns true when the fresh token confirms Pro.
 *
 * The client's `isPro` is deliberately NOT downgraded here: the payment
 * provider is the authoritative fast source for the UI, and a server-side
 * grant gap is exactly the bug we want surfaced (it's logged below), not
 * silently papered over by flipping the user to free.
 */
export async function healProSession(): Promise<boolean> {
  if (auth$.isPro.peek() !== true) return false;
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    logger.error("[networkUtils] healProSession refresh failed", error.message);
    return false;
  }
  const isPro = data.session?.user?.app_metadata?.is_pro === true;
  if (isPro) {
    authActions.setIsPro(true);
    return true;
  }
  logger.warn(
    "[networkUtils] healProSession: fresh JWT still says FREE while payment provider says Pro — check webhook delivery, user_subscriptions, and the Supabase access-token hook",
  );
  return false;
}

/**
 * Generic fetch wrapper with exponential backoff (+ jitter) and timeout.
 * Rejects immediately with `OfflineNetworkError` when the device is
 * definitively offline, so callers can surface the right UX without waiting.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & RetryOptions = {},
): Promise<Response> {
  if (isDefinitelyOffline()) {
    throw new OfflineNetworkError();
  }

  const {
    retries = DEFAULT_OPTIONS.retries!,
    backoff = DEFAULT_OPTIONS.backoff!,
    timeout = DEFAULT_OPTIONS.timeout!,
    retryOnHttpResponse = DEFAULT_OPTIONS.retryOnHttpResponse!,
    signal,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
    }, timeout);
    const onAbort = (): void => {
      clearTimeout(timeoutId);
      controller.abort();
    };
    signal?.addEventListener("abort", onAbort);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      // Only retry on network errors or (optionally) 5xx server errors.
      // 4xx errors (like 401/403/404) should fail immediately in our app logic.
      if (
        response.ok ||
        (response.status >= 400 && response.status < 500) ||
        !retryOnHttpResponse ||
        i === retries - 1
      ) {
        return response;
      }

      throw new Error(`Server Error: ${response.status}`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Don't retry if the request was explicitly aborted by the user
      if (error.name === "AbortError" && signal?.aborted) {
        throw error;
      }

      // An abort that wasn't the caller's signal is the internal timeout.
      // Never retry timeouts: a request that blew its deadline almost never
      // succeeds on retry, and for expensive POSTs retrying doubles provider
      // spend. Fail fast so callers can degrade quietly.
      if (!signal?.aborted && controller.signal.aborted) {
        throw new TimeoutError();
      }

      // Exponential backoff with jitter: 0.5–1.5x of 1s, 2s, 4s...
      const jitter = 0.5 + Math.random() * 0.5;
      const wait = backoff * Math.pow(2, i) * jitter;
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError || new Error("Network request failed");
}

/**
 * Maps worker wire error codes to app errors. Wire codes are matched against
 * @ekwe/shared's WORKER_ERROR_CODES (single source of truth — the worker emits
 * and the app matches the same literals). A handful of client-only codes
 * (NETWORK_LOST, SHARE_COPY_FAIL, TRANSCRIBE_TIMEOUT, TRANSLATION_FAIL) are
 * matched defensively even though the worker never emits them.
 */
export function mapWorkerError(
  code: string,
  fallback: EkweError = EkweError.SERVER_ERROR,
): EkweError {
  switch (code) {
    case "EKWE_NETWORK_LOST":
      return EkweError.NETWORK_LOST;
    case WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL:
      return EkweError.ALL_PROVIDERS_FAIL;
    case "EKWE_SHARE_COPY_FAIL":
      return EkweError.SHARE_COPY_FAIL;
    case WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT:
      return EkweError.EMPTY_TRANSCRIPT;
    case WORKER_ERROR_CODES.EKWE_TRANSCRIPTION_FAIL:
      return EkweError.TRANSCRIPTION_FAIL;
    case "EKWE_TRANSCRIBE_TIMEOUT":
      return EkweError.TRANSCRIBE_TIMEOUT;
    case WORKER_ERROR_CODES.FILE_TOO_LARGE:
      return EkweError.FILE_TOO_LARGE;
    case WORKER_ERROR_CODES.AUDIO_TOO_LONG:
      return EkweError.AUDIO_TOO_LONG;
    case WORKER_ERROR_CODES.EKWE_RATE_LIMIT:
      return EkweError.RATE_LIMITED;
    case WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED:
      return EkweError.QUOTA_EXCEEDED;
    case "EKWE_TRANSLATION_FAIL":
      return EkweError.TRANSLATION_FAIL;
    case WORKER_ERROR_CODES.EKWE_SERVER_ERROR:
      return EkweError.SERVER_ERROR;
    default:
      return fallback;
  }
}
