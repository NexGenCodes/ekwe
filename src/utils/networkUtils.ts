/**
 * Pro-Level Network Utilities
 * Handles retries, backoff, and timeouts for robust service connections.
 */

export interface RetryOptions {
  retries?: number;
  backoff?: number; // ms
  timeout?: number; // ms
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: RetryOptions = {
  retries: 3,
  backoff: 1000,
  timeout: 30000, // 30s default
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
    signal,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Combine signals if both provided
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Only retry on network errors or 5xx server errors.
      // 4xx errors (like 401/403/404) should fail immediately in our app logic.
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      throw new Error(`Server Error: ${response.status}`);
    } catch (err: any) {
      lastError = err;

      // Don't retry if the request was explicitly aborted by the user
      if (err.name === 'AbortError' && signal?.aborted) {
        throw err;
      }

      // Exponential backoff: 1s, 2s, 4s...
      const wait = backoff * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  throw lastError || new Error('Network request failed');
}
