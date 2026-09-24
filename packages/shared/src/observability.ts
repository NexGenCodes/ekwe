export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

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
