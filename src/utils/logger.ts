/**
 * Pro-Level Logger Utility
 * Centralized logging control to satisfy the 'no-console' ESLint rule.
 */

const IS_DEV = __DEV__;

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const logger = {
  debug: (...args: unknown[]): void => {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.debug('[DEBUG]', ...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.info('[INFO]', ...args);
    }
  },
  warn: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.warn('[WARN]', ...args);
  },
  error: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error('[ERROR]', ...args);
    // TODO: Remote crash reporting or file-based logging could be added here
  },
};

export default logger;
