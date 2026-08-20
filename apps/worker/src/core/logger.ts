/* eslint-disable no-console */

import { makeLogEntry } from "@ekwe/shared";
import * as Sentry from "@sentry/cloudflare";

let _debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  _debugEnabled = enabled;
}

export const logger = {
  info: (message: string, data?: Record<string, unknown>): void => {
    console.log(makeLogEntry("INFO", message, data));
  },
  error: (message: string, data?: Record<string, unknown>): void => {
    console.error(makeLogEntry("ERROR", message, data));
    const err = data?.error instanceof Error ? data.error : new Error(message);
    Sentry.captureException(err, { extra: data });
  },
  warn: (message: string, data?: Record<string, unknown>): void => {
    console.warn(makeLogEntry("WARN", message, data));
  },
  debug: (message: string, data?: Record<string, unknown>): void => {
    if (_debugEnabled) {
      console.debug(makeLogEntry("DEBUG", message, data));
    }
  },
};