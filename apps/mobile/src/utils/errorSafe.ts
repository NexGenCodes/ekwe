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
