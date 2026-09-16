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
let sentryAddBreadcrumb:
  | ((breadcrumb: {
      category: string;
      message: string;
      level?: string;
    }) => void)
  | null = null;
let sentrySetTag: ((key: string, value: string) => void) | null = null;
let sentrySetContext:
  ((key: string, data: Record<string, unknown>) => void) | null = null;
let sentryCaptureMessage: ((message: string, level?: string) => void) | null =
  null;
let sentrySetUser: ((user: { id: string } | null) => void) | null = null;

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
    Sentry.setUser({ id: "anonymous" });
    sentryCaptureException = Sentry.captureException;
    sentryAddBreadcrumb = Sentry.addBreadcrumb;
    sentrySetTag = Sentry.setTag;
    sentrySetContext = Sentry.setContext;
    sentryCaptureMessage = Sentry.captureMessage;
    sentrySetUser = Sentry.setUser;
  } catch {
    // Sentry not available, continue without it
  }
}

/** Tag the current user on the Sentry scope (id only — no PII). */
export function setSentryUser(user: { id: string } | null): void {
  sentrySetUser?.(user ?? { id: "anonymous" });
}

/** Tag the Sentry scope with a custom key/value (e.g. current screen). */
export function setSentryTag(key: string, value: string): void {
  sentrySetTag?.(key, value);
}

/** Attach a structured context blob (e.g. provider/device/version). */
export function setSentryContext(
  key: string,
  data: Record<string, unknown>,
): void {
  sentrySetContext?.(key, data);
}

/** Report a handled, non-fatal event (info/warn) for monitoring. */
export function captureSentryMessage(message: string, level?: string): void {
  sentryCaptureMessage?.(message, level ?? "info");
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
    if (sentryAddBreadcrumb) {
      sentryAddBreadcrumb({
        category: "console",
        message: args.map(String).join(" "),
        level: "error",
      });
    }
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
