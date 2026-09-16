import { describe, expect, it } from "vitest";

import { makeLogEntry, scrubSentryEvent } from "../observability";

describe("makeLogEntry", () => {
  it("builds a JSON string with level, timestamp, message, and extra data", () => {
    const entryStr = makeLogEntry("INFO", "User logged in", { userId: "123" });
    const entry = JSON.parse(entryStr);

    expect(entry.level).toBe("INFO");
    expect(entry.message).toBe("User logged in");
    expect(entry.userId).toBe("123");
    expect(typeof entry.timestamp).toBe("string");
    // Ensure timestamp is a valid ISO string
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  it("handles missing extra data", () => {
    const entryStr = makeLogEntry("ERROR", "Something broke");
    const entry = JSON.parse(entryStr);

    expect(entry.level).toBe("ERROR");
    expect(entry.message).toBe("Something broke");
    expect(Object.keys(entry).length).toBe(3); // level, message, timestamp
  });
});

describe("scrubSentryEvent", () => {
  it("strips user.email and user.ip_address", () => {
    const event = {
      user: {
        id: "123",
        email: "test@example.com",
        ip_address: "127.0.0.1",
        username: "tester",
      },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.user).toEqual({
      id: "123",
      username: "tester",
    });
  });

  it("strips request.data and request.headers", () => {
    const event = {
      request: {
        url: "https://example.com/api",
        method: "POST",
        data: { sensitive: "payload" },
        headers: { Authorization: "Bearer token" },
      },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request).toEqual({
      url: "https://example.com/api",
      method: "POST",
    });
  });

  it("strips PII-tagged tags", () => {
    const event = {
      tags: {
        safe_tag: "value",
        transcript_length: 100,
        user_email: "test@example.com",
        phone_number: "1234567890",
        raw_text: "hello",
      },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.tags).toEqual({
      safe_tag: "value",
    });
  });

  it("strips breadcrumb data", () => {
    const event = {
      breadcrumbs: [
        { message: "Started", category: "auth" },
        { message: "Login", category: "auth", data: { email: "a@b.com" } },
      ],
    };

    const scrubbed = scrubSentryEvent(event);
    expect((scrubbed.breadcrumbs as any)[0]).toEqual({
      message: "Started",
      category: "auth",
    });
    expect((scrubbed.breadcrumbs as any)[1]).toEqual({
      message: "Login",
      category: "auth",
    });
  });

  it("passes through event with missing or empty PII fields safely", () => {
    const event = {
      environment: "production",
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed).toEqual({ environment: "production" });
  });

  it("swallows exceptions gracefully if sanitization fails (e.g. read-only properties)", () => {
    const event = {};
    // Make user read-only to intentionally cause a TypeError when trying to delete its properties
    Object.defineProperty(event, "user", {
      value: { email: "test@example.com" },
      writable: false,
      configurable: false,
    });

    // Should not throw
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed).toBeDefined();
  });
});
