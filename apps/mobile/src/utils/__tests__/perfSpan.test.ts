import { describe, expect, it } from "vitest";
import { headerValue, parseServerTiming } from "@/utils/perfSpan";

describe("parseServerTiming", () => {
  it("returns an empty object for a missing header", () => {
    expect(parseServerTiming(null)).toEqual({});
    expect(parseServerTiming("")).toEqual({});
  });

  it("parses a single stage", () => {
    expect(parseServerTiming("tts;dur=1234.5")).toEqual({ tts: 1234.5 });
  });

  it("parses multiple stages in the Server-Timing format", () => {
    const header =
      "total;dur=4820, auth;dur=31.2, gate;dur=412.7, cache;dur=8, tts;dur=3900.4";
    expect(parseServerTiming(header)).toEqual({
      total: 4820,
      auth: 31.2,
      gate: 412.7,
      cache: 8,
      tts: 3900.4,
    });
  });

  it("tolerates whitespace around names and values", () => {
    expect(parseServerTiming(" stt ; dur=12 , mt ; dur=34 ")).toEqual({
      stt: 12,
      mt: 34,
    });
  });

  it("ignores non-numeric and unknown descriptors", () => {
    expect(parseServerTiming("tts;desc=cache, tts;dur=5, x;verbose")).toEqual({
      tts: 5,
    });
  });

  it("skips empty segments", () => {
    expect(parseServerTiming("tts;dur=9,,  ,mt;dur=3")).toEqual({
      tts: 9,
      mt: 3,
    });
  });
});

describe("headerValue", () => {
  it("finds an exact match", () => {
    expect(headerValue({ "Server-Timing": "a;dur=1" }, "Server-Timing")).toBe(
      "a;dur=1",
    );
  });

  it("matches case-insensitively", () => {
    expect(headerValue({ "server-timing": "a;dur=1" }, "Server-Timing")).toBe(
      "a;dur=1",
    );
    expect(headerValue({ "SERVER-TIMING": "a;dur=1" }, "server-timing")).toBe(
      "a;dur=1",
    );
  });

  it("returns null when absent or headers are undefined", () => {
    expect(headerValue({}, "Server-Timing")).toBeNull();
    expect(headerValue(undefined, "Server-Timing")).toBeNull();
  });
});
