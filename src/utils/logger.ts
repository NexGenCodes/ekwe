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
