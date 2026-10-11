import { describe, expect, it } from "vitest";

import { toSentryCapture } from "../logger";

describe("toSentryCapture", () => {
  // Regression: `logger.error` used to pass the joined log string to
  // `captureException`, which filed a stackless synthetic issue per distinct
  // message (Sentry REACT-NATIVE-A/B/C) and discarded the stack of any real
  // Error passed alongside the message.
  it("captures a real Error so its stack survives", () => {
    const cause = new Error("boom");
    const { error } = toSentryCapture(["[Sync] subscribe failed:", cause]);

    expect(error).toBe(cause);
    expect(error.stack).toContain("boom");
  });

  it("keeps surrounding log args as context", () => {
    const cause = new TypeError("bad state");
    const { error, extra } = toSentryCapture([
      "[Auth] configure error:",
      cause,
      "attempt=2",
    ]);

    expect(error).toBe(cause);
    expect(extra).toEqual({
      logArgs: ["[Auth] configure error:", "attempt=2"],
    });
  });

  it("synthesizes an Error when no Error is present", () => {
    const { error, extra } = toSentryCapture(["[EchoFlow] rejected", 429]);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("[EchoFlow] rejected 429");
    expect(extra).toEqual({});
  });

  it("never sends an empty message", () => {
    expect(toSentryCapture([]).error.message).toBe(
      "logger.error() with no message",
    );
  });
});
