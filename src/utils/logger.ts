/**
 * Pro-Level Logger Utility
 * Centralized logging control to satisfy the 'no-console' ESLint rule.
 */

const IS_DEV = __DEV__;
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const noop = (): void => {};

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Initialize Sentry in production if DSN is configured
let sentryCaptureException: ((err: unknown) => void) | null = null;

if (!IS_DEV && SENTRY_DSN && SENTRY_DSN.startsWith("https://")) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/react-native");
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.EXPO_PUBLIC_ENV || "production",
      tracesSampleRate: 0.1,
      integrations: [Sentry.reactNativeTracingIntegration()],
      // Scrub potentially sensitive user content before sending to Sentry
      beforeSend: (event: Record<string, unknown>) => {
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
          // If sanitizer fails, do not block error reporting
        }
        return event;
      },
    });
    sentryCaptureException = Sentry.captureException;
  } catch {
    // Sentry not available, continue without it
  }
}

/* eslint-disable no-console */
const logger: Logger = {
  debug: IS_DEV
    ? (...args): void => {
        console.debug("[DEBUG]", ...args);
      }
    : noop,
  info: IS_DEV
    ? (...args): void => {
        console.info("[INFO]", ...args);
      }
    : noop,
  warn: IS_DEV
    ? (...args): void => {
        console.warn("[WARN]", ...args);
      }
    : noop,
  error: (...args): void => {
    console.error("[ERROR]", ...args);
    if (sentryCaptureException) {
      const first = args[0];
      if (first instanceof Error) {
        sentryCaptureException(first);
      } else {
        sentryCaptureException(args.map(String).join(" "));
      }
    }
  },
};

export default logger;
