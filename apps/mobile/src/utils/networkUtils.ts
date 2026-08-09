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
import { EkweError } from "@/constants/errors";
import { isDefinitelyOffline } from "@/store/network";

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
 * Single source of truth for mapping worker error codes to app errors.
 * Also accepts the two spellings the worker uses for "all providers failed"
 * (`EKWE_ALL_PROVIDERS_FAIL` on /translate, `ALL_PROVIDERS_FAILED` on
 * /transcribe) so the two routes can't drift.
 */
export function mapWorkerError(
  code: string,
  fallback: EkweError = EkweError.SERVER_ERROR,
): EkweError {
  switch (code) {
    case "EKWE_NETWORK_LOST":
      return EkweError.NETWORK_LOST;
    case "EKWE_ALL_PROVIDERS_FAIL":
    case "ALL_PROVIDERS_FAILED":
      return EkweError.ALL_PROVIDERS_FAIL;
    case "EKWE_SHARE_COPY_FAIL":
      return EkweError.SHARE_COPY_FAIL;
    case "EKWE_EMPTY_TRANSCRIPT":
      return EkweError.EMPTY_TRANSCRIPT;
    case "EKWE_TRANSCRIPTION_FAIL":
      return EkweError.TRANSCRIPTION_FAIL;
    case "EKWE_TRANSCRIBE_TIMEOUT":
      return EkweError.TRANSCRIBE_TIMEOUT;
    case "EKWE_FILE_TOO_LARGE":
      return EkweError.FILE_TOO_LARGE;
    case "EKWE_RATE_LIMITED":
    case "EKWE_RATE_LIMIT":
      return EkweError.RATE_LIMITED;
    case "EKWE_TRANSLATION_FAIL":
      return EkweError.TRANSLATION_FAIL;
    case "EKWE_SERVER_ERROR":
      return EkweError.SERVER_ERROR;
    default:
      return fallback;
  }
}