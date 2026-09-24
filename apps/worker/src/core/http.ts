export interface ErrorOptions {
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
}

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
