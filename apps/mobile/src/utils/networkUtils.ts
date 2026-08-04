/**
 * Pro-Level Network Utilities
 * Handles retries, backoff, and timeouts for robust service connections.
 */

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

/**
 * Generic fetch wrapper with exponential backoff and timeout.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & RetryOptions = {},
): Promise<Response> {
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

      // Exponential backoff: 1s, 2s, 4s...
      const wait = backoff * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError || new Error("Network request failed");
}
