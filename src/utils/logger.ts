/**
 * Pro-Level Logger Utility
 * Wraps console methods to allow for centralized logging control
 * and to satisfy the 'no-console' ESLint rule.
 */

const IS_DEV = __DEV__;

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
      console.log('[INFO]', ...args);
    }
  },
  warn: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.warn('[WARN]', ...args);
  },
  error: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error('[ERROR]', ...args);
  },
};

export default logger;
