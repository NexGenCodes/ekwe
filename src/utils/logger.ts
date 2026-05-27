/**
 * Pro-Level Logger Utility
 * Centralized logging control to satisfy the 'no-console' ESLint rule.
 */

const IS_DEV = __DEV__;
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const noop = (): void => {};

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Initialize Sentry in production if DSN is configured
let sentryCaptureException: ((err: unknown) => void) | null = null;

if (!IS_DEV && SENTRY_DSN && SENTRY_DSN.startsWith('https://')) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/react-native');
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.EXPO_PUBLIC_ENV || 'production',
      tracesSampleRate: 0.1,
      integrations: [Sentry.reactNativeTracingIntegration()],
      // Scrub potentially sensitive user content before sending to Sentry
      beforeSend: (event: any) => {
        try {
          // Remove user-identifiable info
          if (event.user) {
            if (event.user.email) delete event.user.email;
            if (event.user.ip_address) delete event.user.ip_address;
          }

          // Remove request payloads which may contain transcripts or PII
          if (event.request) {
            delete event.request.data;
            delete event.request.headers;
          }

          // Remove any tags that might contain raw text
          if (event.tags) {
            Object.keys(event.tags).forEach((k) => {
              if (/transcript|email|phone|text/i.test(k)) delete event.tags[k];
            });
          }

          // Remove excessive breadcrumbs that may contain user text
          if (Array.isArray(event.breadcrumbs)) {
            event.breadcrumbs = event.breadcrumbs.map((b: any) => {
              if (b && b.data) {
                // strip payloads
                delete b.data;
              }
              return b;
            });
          }
        } catch (e) {
          // If sanitizer fails, do not block error reporting
        }
        return event;
      },
    });
    sentryCaptureException = Sentry.captureException;
    // eslint-disable-next-line no-console
    console.info('[logger] Sentry initialized');
  } catch {
    // Sentry not available, continue without it
  }
}

if (IS_DEV && (!SENTRY_DSN || SENTRY_DSN.includes('xxxxx'))) {
  // eslint-disable-next-line no-console
  console.warn(
    '[logger] Sentry DSN not configured - crashes will not be tracked',
  );
}

const logger: Logger = {
  debug: IS_DEV
    ? (...args): void => {
        // eslint-disable-next-line no-console
        console.debug('[DEBUG]', ...args);
      }
    : noop,
  info: IS_DEV
    ? (...args): void => {
        // eslint-disable-next-line no-console
        console.info('[INFO]', ...args);
      }
    : noop,
  warn: IS_DEV
    ? (...args): void => {
        // eslint-disable-next-line no-console
        console.warn('[WARN]', ...args);
      }
    : noop,
  error: (...args): void => {
    // eslint-disable-next-line no-console
    console.error('[ERROR]', ...args);
    if (sentryCaptureException) {
      const first = args[0];
      if (first instanceof Error) {
        sentryCaptureException(first);
      } else {
        sentryCaptureException(args.map(String).join(' '));
      }
    }
  },
};

export default logger;
