import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions, EventHint } from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { scrubSentryEvent } from "@ekwe/shared";

function beforeSend(
  event: Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0],
  _hint: EventHint,
) {
  return scrubSentryEvent(
    event as unknown as Record<string, unknown>,
  ) as unknown as ReturnType<NonNullable<CloudflareOptions["beforeSend"]>>;
}

/** Options for the `withSentry` worker handler wrapper. `undefined` skips SDK init. */
function optionsFor(env: Env): CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN;
  if (typeof dsn !== "string" || dsn.length === 0) {
    return undefined;
  }
  return {
    dsn,
    tracesSampleRate: 0.01,
    beforeSend,
  };
}

/** Same options but always defined — Durable Object instrumentation requires it. */
function optionsForDo(env: Env): CloudflareOptions {
  return optionsFor(env) ?? {};
}

export function instrumentWorker<H extends ExportedHandler<Env>>(handler: H): H {
  return Sentry.withSentry(optionsFor, handler);
}

export function instrumentDurableObject<
  C extends new (state: DurableObjectState, env: Env) => DurableObject<Env>,
>(DurableObjectClass: C): C {
  return Sentry.instrumentDurableObjectWithSentry(optionsForDo, DurableObjectClass);
}