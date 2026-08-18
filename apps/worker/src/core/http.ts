/**
 * ─── HTTP response builders ──────────────────────────────────────
 * Single source of truth for JSON + error responses across the worker,
 * so every route produces an identical wire shape and Content-Type.
 */

export interface ErrorOptions {
  headers?: Record<string, string>;
  /** Extra fields merged onto the error body (e.g. quota snapshot). */
  extra?: Record<string, unknown>;
}

/** JSON response with the standard Content-Type header applied. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}

/**
 * Error response following the worker wire contract: `{ error, message }`.
 * `extra` merges additional fields onto the body.
 */
export function error(
  code: string,
  status: number,
  message?: string,
  options: ErrorOptions = {},
): Response {
  const body: Record<string, unknown> = { error: code };
  if (message) body.message = message;
  if (options.extra) Object.assign(body, options.extra);
  const headers = new Headers(options.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

/**
 * Recoverable error thrown inside route handlers; the request pipeline maps
 * it to an `error()` response and logs the cause. Routes may return Response
 * objects directly instead — throwing is for post-guard failures.
 */
export class HttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly extra?: Record<string, unknown>,
    message?: string,
    options?: { cause?: unknown; headers?: Record<string, string> },
  ) {
    super(message ?? "An unexpected error occurred.", options);
    this.headers = options?.headers;
  }

  public readonly headers?: Record<string, string>;
}