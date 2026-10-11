import type { Logger } from "@ekwe/shared";
import { scrubSentryEvent } from "@ekwe/shared";

const IS_DEV = __DEV__;
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const noop = (): void => {};

let sentryCaptureException:
  ((err: unknown, hint?: { extra?: Record<string, unknown> }) => void) | null =
  null;
let sentryAddBreadcrumb:
  | ((breadcrumb: {
      category: string;
      message: string;
      level?: string;
      data?: Record<string, unknown>;
    }) => void)
  | null = null;
let sentrySetTag: ((key: string, value: string) => void) | null = null;
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

      beforeSend: scrubSentryEvent,
    });
    Sentry.setUser({ id: "anonymous" });
    sentryCaptureException = Sentry.captureException;
    sentryAddBreadcrumb = Sentry.addBreadcrumb;
    sentrySetTag = Sentry.setTag;
    sentrySetUser = Sentry.setUser;
  } catch {
    // Sentry not available, continue without it
  }
}

/**
 * Maps `logger.error(...args)` to the error Sentry should file. Without this,
 * `logger.error("[Sync] ...", cause)` filed the joined message as a
 * stackless issue and dropped the real Error's stack.
 */
export function toSentryCapture(args: unknown[]): {
  error: Error;
  extra: { logArgs: string[] } | Record<string, never>;
} {
  const cause = args.find((a) => a instanceof Error);
  if (cause) {
    const rest = args.filter((a) => a !== cause).map((a) => String(a));
    return {
      error: cause,
      extra: rest.length > 0 ? { logArgs: rest } : {},
    };
  }
  const message = args.map(String).join(" ");
  return {
    error: new Error(message || "logger.error() with no message"),
    extra: {},
  };
}

export function setSentryUser(user: { id: string } | null): void {
  sentrySetUser?.(user ?? { id: "anonymous" });
}

export function setSentryTag(key: string, value: string): void {
  sentrySetTag?.(key, value);
}

/**
 * Records a production-visible event. Unlike `logger.info`, which is compiled
 * out of release builds, breadcrumbs survive to Sentry, so this is how
 * non-error outcomes (such as a preview cache hit) become measurable.
 */
export function addSentryBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  sentryAddBreadcrumb?.({
    category,
    message,
    level: "info",
    data,
  });
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
      const { error, extra } = toSentryCapture(args);
      sentryCaptureException(error, { extra });
    }
  },
};

export default logger;
