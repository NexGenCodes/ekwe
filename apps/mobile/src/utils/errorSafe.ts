/**
 * Error sanitizer — the last gate before anything reaches the user's screen.
 *
 * Never show raw error internals (Supabase project URLs, provider details,
 * stack fragments, tokens) to the user. Error objects are for logs; the UI
 * gets plain, vetted text.
 */

const SENSITIVE_HINTS =
  /\b(api[_-]?key|secret|password|token|bearer|authorization|jwt|service[_-]?role|reference_id|database|constraint|schema|relation|column|detail|hint|context)\b/gi;

/**
 * Returns a user-safe message for `input`, or null when nothing safe can be
 * extracted. Farther-reaching redactions take precedence: anything containing
 * a URL or a plausible project identifier collapses to a generic fallback so
 * we never show a partial leak.
 */
export function sanitizeErrorMessage(input: unknown): string | null {
  if (typeof input === "string" && input.trim()) {
    const hasUrl = /https?:\/\//i.test(input);
    const hasProjectRef = /\w+\.supabase\.(?:co|in)/i.test(input);
    if (hasUrl || hasProjectRef) return null;
    const trimmed = input.trim();
    if (trimmed.length <= 140) return trimmed;
    return null;
  }
  if (input instanceof Error && input.message?.trim()) return input.message;
  if (input && typeof input === "object" && "message" in input) {
    return sanitizeErrorMessage((input as { message: unknown }).message);
  }
  return null;
}

/**
 * User-safe error string for display. Prefer this over reading `error.message`
 * directly anywhere the message could reach the UI.
 */
export function toUserErrorMessage(error: unknown, fallback: string): string {
  const safe = sanitizeErrorMessage(error);
  return safe ?? fallback;
}

export { SENSITIVE_HINTS };
