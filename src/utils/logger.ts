/**
 * Pro-Level Logger Utility
 * Centralized logging control to satisfy the 'no-console' ESLint rule.
 */

const IS_DEV = __DEV__;

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

const logger: Logger = {
  debug: IS_DEV
    ? (...args) => {
        // eslint-disable-next-line no-console
        console.debug('[DEBUG]', ...args);
      }
    : noop,
  info: IS_DEV
    ? (...args) => {
        // eslint-disable-next-line no-console
        console.info('[INFO]', ...args);
      }
    : noop,
  warn: IS_DEV
    ? (...args) => {
        // eslint-disable-next-line no-console
        console.warn('[WARN]', ...args);
      }
    : noop,
  error: (...args) => {
    // eslint-disable-next-line no-console
    console.error('[ERROR]', ...args);
    // TODO: Route to remote crash reporting (Sentry, Datadog, etc.)
  },
};

export default logger;
