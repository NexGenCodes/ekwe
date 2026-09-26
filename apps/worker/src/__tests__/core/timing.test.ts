import { describe, expect, it, vi } from "vitest";
import { RequestTimings } from "@/core/timing";

describe("RequestTimings", () => {
  it("returns null when nothing was recorded", () => {
    const timings = new RequestTimings();
    expect(timings.toServerTiming(12)).toBeNull();
  });

  it("serializes a recorded stage with its duration", () => {
    vi.useFakeTimers();
    try {
      const timings = new RequestTimings();
      timings.start("tts");
      vi.advanceTimersByTime(120);
      timings.end("tts");

      expect(timings.toServerTiming(200)).toBe("total;dur=200, tts;dur=120");
    } finally {
      vi.useRealTimers();
    }
  });

  it("always includes total first, then stages in stable sorted order", () => {
    vi.useFakeTimers();
    try {
      const timings = new RequestTimings();
      for (const name of ["tts", "auth", "cache"]) {
        timings.start(name);
        vi.advanceTimersByTime(10);
        timings.end(name);
      }
      const header = timings.toServerTiming(999);
      expect(header).toBe(
        "total;dur=999, auth;dur=10, cache;dur=10, tts;dur=10",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores end() with no matching start()", () => {
    const timings = new RequestTimings();
    timings.end("tts");
    expect(timings.toServerTiming(5)).toBeNull();
  });

  it("ignores a duplicate start() for the same stage", () => {
    vi.useFakeTimers();
    try {
      const timings = new RequestTimings();
      timings.start("gate");
      vi.advanceTimersByTime(50);
      // A second start must not reset the original start time, otherwise a
      // nested/duplicated call would silently shrink the reported duration.
      timings.start("gate");
      vi.advanceTimersByTime(50);
      timings.end("gate");
      expect(timings.toServerTiming(100)).toContain("gate;dur=100");
    } finally {
      vi.useRealTimers();
    }
  });

  it("accumulates repeated measurements of the same stage", () => {
    vi.useFakeTimers();
    try {
      const timings = new RequestTimings();
      timings.start("stt");
      vi.advanceTimersByTime(30);
      timings.end("stt");
      timings.start("stt");
      vi.advanceTimersByTime(20);
      timings.end("stt");
      expect(timings.toServerTiming(50)).toContain("stt;dur=50");
    } finally {
      vi.useRealTimers();
    }
  });

  it("records the stage when the measured function throws", async () => {
    vi.useFakeTimers();
    try {
      const timings = new RequestTimings();
      const failing = timings.measure("gate", async () => {
        vi.advanceTimersByTime(40);
        throw new Error("boom");
      });
      await expect(failing).rejects.toThrow("boom");
      expect(timings.toServerTiming(40)).toContain("gate;dur=40");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the measured value from measure()", async () => {
    const timings = new RequestTimings();
    await expect(timings.measure("auth", async () => "ok")).resolves.toBe("ok");
  });

  it("exposes a structured copy via toJSON", () => {
    vi.useFakeTimers();
    try {
      const timings = new RequestTimings();
      timings.start("mt");
      vi.advanceTimersByTime(7);
      timings.end("mt");
      expect(timings.toJSON()).toEqual({ mt: 7 });
    } finally {
      vi.useRealTimers();
    }
  });
});
