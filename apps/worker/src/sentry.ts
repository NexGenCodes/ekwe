import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions, EventHint } from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { scrubSentryEvent } from "@ekwe/shared";

function beforeSend(
  event: Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0],
  _hint: EventHint,
) {
  if (isLocalDevEvent(event)) return null;
  return scrubSentryEvent(
    event as unknown as Record<string, unknown>,
  ) as unknown as ReturnType<NonNullable<CloudflareOptions["beforeSend"]>>;
}

/**
 * Drops anything raised by a local `wrangler dev` session.
 *
 * `APP_ENV` defaults to "production" in wrangler.jsonc so that deploys never
 * ship with debug logging, which means a developer who has not yet copied
 * `.dev.vars.example` to `.dev.vars` runs with a production Sentry client and
 * files local failures — missing bindings, unavailable Workers AI, hand-edited
 * fixtures — against the live project. That is indistinguishable from a real
 * outage once it lands, and it buries the errors we actually want to see.
 *
 * The runtime gives no local-vs-deployed signal: `navigator.userAgent` is
 * "Cloudflare-Workers" in both, and `request.cf` is populated either way. The
 * request URL is the one thing that differs, since `wrangler dev` only ever
 * serves from loopback.
 */
export function isLocalDevEvent(
  event: Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0],
): boolean {
  const request = (event as { request?: { url?: unknown } }).request;
  if (typeof request?.url !== "string") return false;
  try {
    const { hostname } = new URL(request.url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function optionsFor(env: Env): CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN;
  if (typeof dsn !== "string" || dsn.length === 0) {
    return undefined;
  }
  if (env.APP_ENV !== "production") {
    return undefined;
  }
  return {
    dsn,
    environment: "production",
    tracesSampleRate: 0.01,
    beforeSend,
  };
}

function optionsForDo(env: Env): CloudflareOptions {
  return optionsFor(env) ?? {};
}

export function instrumentWorker<H extends ExportedHandler<Env>>(
  handler: H,
): H {
  return Sentry.withSentry(optionsFor, handler);
}

export function instrumentDurableObject<
  C extends new (state: DurableObjectState, env: Env) => DurableObject<Env>,
>(DurableObjectClass: C): C {
  return Sentry.instrumentDurableObjectWithSentry(
    optionsForDo,
    DurableObjectClass,
  );
}
