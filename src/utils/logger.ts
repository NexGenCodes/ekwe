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

function formatMessage(level: LogLevel, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}]`;
}

const logger = {
  debug: (...args: unknown[]): void => {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.debug(formatMessage(LogLevel.DEBUG, args), ...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.info(formatMessage(LogLevel.INFO, args), ...args);
    }
  },
  warn: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.warn(formatMessage(LogLevel.WARN, args), ...args);
  },
  error: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error(formatMessage(LogLevel.ERROR, args), ...args);
    // TODO: Remote crash reporting or file-based logging could be added here
  },
};

export default logger;
