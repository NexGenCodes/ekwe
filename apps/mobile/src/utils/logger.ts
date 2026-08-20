/**
 * Pro-Level Logger Utility
 * Centralized logging control to satisfy the 'no-console' ESLint rule.
 */

import type { Logger } from "@ekwe/shared";
import { scrubSentryEvent } from "@ekwe/shared";

const IS_DEV = __DEV__;
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const noop = (): void => {};

// Initialize Sentry in production if DSN is configured
let sentryCaptureException: ((err: unknown) => void) | null = null;

if (!IS_DEV && SENTRY_DSN && SENTRY_DSN.startsWith("https://")) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.EXPO_PUBLIC_ENV || "production",
      tracesSampleRate: 0.1,
      integrations: [Sentry.reactNativeTracingIntegration()],
      // Scrub potentially sensitive user content before sending to Sentry.
      // Policy is shared with the worker via @ekwe/shared.
      beforeSend: scrubSentryEvent,
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
