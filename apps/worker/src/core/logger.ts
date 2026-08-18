/* eslint-disable no-console */

let _debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  _debugEnabled = enabled;
}

function makeEntry(
  level: string,
  message: string,
  data?: Record<string, unknown>,
) {
  return JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    message,
    ...data,
  });
}

export const logger = {
  info: (message: string, data?: Record<string, unknown>): void => {
    console.log(makeEntry("INFO", message, data));
  },
  error: (message: string, data?: Record<string, unknown>): void => {
    console.error(makeEntry("ERROR", message, data));
  },
  warn: (message: string, data?: Record<string, unknown>): void => {
    console.warn(makeEntry("WARN", message, data));
  },
  debug: (message: string, data?: Record<string, unknown>): void => {
    if (_debugEnabled) {
      console.debug(makeEntry("DEBUG", message, data));
    }
  },
};
