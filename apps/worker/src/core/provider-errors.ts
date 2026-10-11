/**
 * Provider failure taxonomy.
 *
 * The contract: a provider returns `null` only for a legitimately empty result
 * (blank transcript, hallucination, unvoiceable script). Every transport, auth,
 * rate-limit and server failure throws.
 *
 * The distinction matters — a throw is classified, retried, counted against the
 * circuit breaker and recorded in telemetry; a `null` moves to the next provider
 * silently. Collapsing the two leaves retries, the breaker and telemetry wired
 * up but unreachable, because nothing ever throws.
 */

export type ProviderErrorClass =
  | "timeout"
  | "network"
  | "rate-limit"
  | "auth"
  | "server"
  | "client"
  | "unknown";

/** The provider answered, and the answer was not usable. */
export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly body: string;

  constructor(provider: string, status: number, body = "") {
    super(`${provider} returned HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.body = body.slice(0, 500);
  }
}

/** The attempt exceeded its slice of the pipeline budget. */
export class ProviderTimeoutError extends Error {
  readonly provider: string;
  readonly timeoutMs: number;

  constructor(provider: string, timeoutMs: number) {
    super(`${provider} timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

/** DNS, TLS, reset, hang-up — the request never landed. */
export class ProviderTransportError extends Error {
  readonly provider: string;
  override readonly cause?: unknown;

  constructor(provider: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${provider} transport failure: ${detail}`);
    this.name = "ProviderTransportError";
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * A request the provider will deterministically reject: a missing credential,
 * an unsupported codec, a discarded hallucination.
 *
 * Classified `client`, not `server`, because the same request produces the same
 * rejection — retrying spends an attempt and a backoff to learn nothing. It
 * still counts against the breaker, since repeated rejections mean something is
 * genuinely misconfigured.
 */
export class ProviderUnusableError extends Error {
  readonly provider: string;

  constructor(provider: string, detail: string) {
    super(`${provider}: ${detail}`);
    this.name = "ProviderUnusableError";
    this.provider = provider;
  }
}

export function classifyHttpStatus(status: number): ProviderErrorClass {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limit";
  if (status === 401 || status === 402 || status === 403) return "auth";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unknown";
}

export function isRetryableClass(klass: ProviderErrorClass): boolean {
  return (
    klass === "timeout" ||
    klass === "network" ||
    klass === "rate-limit" ||
    klass === "server" ||
    klass === "unknown"
  );
}

/**
 * Typed classes first, text inference only as a fallback for third-party
 * throws — so reworded messages cannot change how a failure is classified.
 */
export function classifyError(error: unknown): ProviderErrorClass {
  if (error instanceof Error && error.name === "ProviderHttpError") {
    return classifyHttpStatus((error as ProviderHttpError).status);
  }
  if (error instanceof Error && error.name === "ProviderTimeoutError") {
    return "timeout";
  }
  if (error instanceof Error && error.name === "ProviderTransportError") {
    return "network";
  }
  if (error instanceof Error && error.name === "ProviderUnusableError") {
    return "client";
  }
  if (error instanceof Error && error.message === "CLIENT_ABORTED") {
    return "client";
  }

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
    text.includes("401") ||
    text.includes("402") ||
    text.includes("403") ||
    text.includes("unauthorized") ||
    text.includes("forbidden")
  )
    return "auth";
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
