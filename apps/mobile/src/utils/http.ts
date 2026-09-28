import { WORKER_ERROR_CODES } from "@ekwe/shared";

import { EkweError } from "@/constants/errors";
import { isDefinitelyOffline } from "@/store/network";

export interface RetryOptions {
  retries?: number;
  backoff?: number;
  timeout?: number;
  signal?: AbortSignal;

  retryOnHttpResponse?: boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  retries: 3,
  backoff: 1000,
  timeout: 30000,
  retryOnHttpResponse: true,
};

export class OfflineNetworkError extends Error {
  constructor() {
    super("Device is offline");
    this.name = "OfflineNetworkError";
  }
}

export const isOfflineNetworkError = (err: unknown): boolean =>
  err instanceof OfflineNetworkError;

export class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

export const isTimeoutError = (err: unknown): boolean =>
  err instanceof TimeoutError;

export const getWorkerUrl = (): string =>
  process.env.EXPO_PUBLIC_WORKER_URL ?? "";

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

      if (error.name === "AbortError" && signal?.aborted) {
        throw error;
      }

      if (!signal?.aborted && controller.signal.aborted) {
        throw new TimeoutError();
      }

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
    // Without this a free account asking for a Pro voice gets a generic failure
    // and no idea the voice is the problem.
    case WORKER_ERROR_CODES.PREMIUM_FEATURE_REQUIRED:
      return EkweError.PREMIUM_REQUIRED;
    // The worker distinguishes "we tried and every provider was down" from
    // "your request was wrong". Collapsing them into a generic failure is
    // what made an outage look like the user's fault.
    case WORKER_ERROR_CODES.SPEECH_UNAVAILABLE:
    case WORKER_ERROR_CODES.SERVICE_UNAVAILABLE:
      return EkweError.SPEECH_UNAVAILABLE;
    case "EKWE_SPEECH_TIMEOUT":
      return EkweError.SPEECH_TIMEOUT;
    case WORKER_ERROR_CODES.EKWE_SERVER_ERROR:
      return EkweError.SERVER_ERROR;
    default:
      return fallback;
  }
}
