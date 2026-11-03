/**
 * expo/fetch rejects a cancelled request with a plain Error carrying a native
 * code or message, not a DOMException named `AbortError`.
 */

const ABORT_CODES = new Set(["ERR_REQUEST_CANCELED", "ERR_ABORTED"]);

const ABORT_MESSAGES = new Set([
  "AbortError",
  "CLIENT_ABORTED",
  "Fetch request has been canceled",
]);

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && ABORT_CODES.has(code)) return true;

  return ABORT_MESSAGES.has(error.message);
}

/** Normalizes a cancellation into the shape every caller already checks. */
export function createAbortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}
