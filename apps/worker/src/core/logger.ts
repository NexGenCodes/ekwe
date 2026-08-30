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
    // The `@sentry/cloudflare` server SDK does not attach the `extra` hint to
    // the event, so a bare `new Error(message)` would hide the actual cause.
    // Surface `data.error` (or its string form) as the exception itself.
    const cause = data?.error;
    const err =
      cause instanceof Error
        ? cause
        : new Error(cause == null ? message : `${message}: ${String(cause)}`);
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
