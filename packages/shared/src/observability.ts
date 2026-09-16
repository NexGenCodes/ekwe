/**
 * ─── Shared Observability Contracts ─────────────────────────────
 *
 * Platform-agnostic pieces shared by the mobile app and the worker so the
 * PII policy and the structured-log shape live in ONE place. The actual SDK
 * init stays in each app (React Native uses @sentry/react-native +
 * posthog-react-native; the worker uses @sentry/cloudflare + Cloudflare
 * Observability) because the SDKs are incompatible — only the pure pieces
 * that operate on plain objects belong here.
 *
 * - `Logger`       — the method shape both apps implement.
 * - `makeLogEntry` — builds the JSON line the worker emits to stdout (which
 *                    Cloudflare Observability ingests).
 * - `scrubSentryEvent` — deletes PII from a Sentry event before it ships.
 *                    Runs in `beforeSend` on BOTH Sentry instances so the
 *                    scrub policy can never drift between platforms.
 */

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Builds the structured JSON log line. `level` is the uppercase severity,
 * `message` the human-readable summary, and `data` any structured context
 * to correlate (request id, provider, status, ...). Optional keys must not
 * collide with `level`/`timestamp`/`message`.
 */
export function makeLogEntry(
  level: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  return JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    message,
    ...data,
  });
}

/**
 * Removes likely-PII from a Sentry event before it leaves the device/edge.
 * Handles the shared surface (user, request, tags, breadcrumbs) defensively
 * so a shape change in either SDK can never block error reporting.
 */
export function scrubSentryEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const ev = event as Record<string, Record<string, unknown>>;

    if (ev.user) {
      delete ev.user.email;
      delete ev.user.ip_address;
    }

    if (ev.request) {
      delete ev.request.data;
      delete ev.request.headers;
    }

    if (ev.tags) {
      Object.keys(ev.tags).forEach((k) => {
        if (/transcript|email|phone|text/i.test(k)) delete ev.tags[k];
      });
    }

    if (Array.isArray(ev.breadcrumbs)) {
      ev.breadcrumbs = (ev.breadcrumbs as Record<string, unknown>[]).map(
        (b: Record<string, unknown>) => {
          if (b && b.data) {
            delete b.data;
          }
          return b;
        },
      ) as unknown as Record<string, unknown>;
    }
  } catch {
    // If sanitization fails, do not block error reporting.
  }
  return event;
}
