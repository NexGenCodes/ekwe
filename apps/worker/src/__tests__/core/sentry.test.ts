import { describe, test, expect } from "vitest";

import { isLocalDevEvent } from "@/sentry";

/**
 * `wrangler dev` only ever serves from loopback, so a loopback request URL is
 * the one signal that separates a local session from a deployed one. Anything
 * that is not provably local must be kept — dropping a real production error is
 * far worse than filing a stray local one.
 *
 * The predicate only reads `request.url`, so the events built here carry just
 * that field.
 */
type SentryEvent = Parameters<typeof isLocalDevEvent>[0];

const event = (url?: unknown): SentryEvent =>
  ({ request: { url } }) as unknown as SentryEvent;

describe("isLocalDevEvent", () => {
  test("identifies every loopback form wrangler dev can bind", () => {
    for (const url of [
      "http://localhost:8787/synthesize",
      "https://localhost/synthesize",
      "http://127.0.0.1:8787/synthesize",
      "http://[::1]:8787/synthesize",
      "http://app.localhost:8787/synthesize",
    ]) {
      expect(isLocalDevEvent(event(url))).toBe(true);
    }
  });

  test("keeps deployed hostnames", () => {
    for (const url of [
      "https://ekwe-proxy.example.workers.dev/translate",
      "https://localhost.evil.com/synthesize",
      "http://127.0.0.1.evil.com/synthesize",
    ]) {
      expect(isLocalDevEvent(event(url))).toBe(false);
    }
  });

  test("keeps events that carry no usable request URL", () => {
    // Alarms and other background work have no request; assume production.
    expect(isLocalDevEvent({} as SentryEvent)).toBe(false);
    expect(isLocalDevEvent(event(undefined))).toBe(false);
    expect(isLocalDevEvent(event(null))).toBe(false);
    expect(isLocalDevEvent(event(42))).toBe(false);
    expect(isLocalDevEvent(event("not a url"))).toBe(false);
  });
});
