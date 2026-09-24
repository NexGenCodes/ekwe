import { describe, expect, test, vi, afterEach } from "vitest";
import {
  classifyProviderError,
  isRetryableErrorClass,
  jitteredBackoffMs,
  runProviderFailover,
} from "@/utils/retry";
import { CLIENT_ABORTED } from "@/core/types";

const signal = (): AbortSignal => new AbortController().signal;

const randomSpies: Array<() => void> = [];
afterEach(() => {
  while (randomSpies.length) randomSpies.pop()!();
});

function deterministicRandom(): void {
  const spy = vi.spyOn(Math, "random").mockReturnValue(0);
  randomSpies.push(() => spy.mockRestore());
}

describe("classifyProviderError", () => {
  test("classifies client abort as client", () => {
    expect(classifyProviderError(new Error(CLIENT_ABORTED))).toBe("client");
  });

  test("classifies timeouts", () => {
    expect(classifyProviderError(new Error("deadline exceeded"))).toBe(
      "timeout",
    );
    const to = new Error("timed out");
    to.name = "TimeoutError";
    expect(classifyProviderError(to)).toBe("timeout");
  });

  test("classifies rate limits and server errors", () => {
    expect(classifyProviderError(new Error("429 Too Many Requests"))).toBe(
      "rate-limit",
    );
    expect(classifyProviderError(new Error("upstream 503"))).toBe("server");
    expect(classifyProviderError(new Error("502 Bad Gateway"))).toBe("server");
  });

  test("classifies network errors", () => {
    expect(classifyProviderError(new Error("fetch failed"))).toBe("network");
    expect(classifyProviderError(new Error("ECONNRESET socket"))).toBe(
      "network",
    );
  });

  test("falls through to unknown", () => {
    expect(classifyProviderError(new Error("schema boom"))).toBe("unknown");
  });

  test("isRetryableErrorClass gates the retryable set", () => {
    expect(isRetryableErrorClass("timeout")).toBe(true);
    expect(isRetryableErrorClass("network")).toBe(true);
    expect(isRetryableErrorClass("rate-limit")).toBe(true);
    expect(isRetryableErrorClass("server")).toBe(true);
    expect(isRetryableErrorClass("client")).toBe(false);
    expect(isRetryableErrorClass("unknown")).toBe(false);
  });
});

describe("jitteredBackoffMs", () => {
  test("stays within the cap and never negative", () => {
    for (let i = 0; i < 50; i++) {
      const v = jitteredBackoffMs(1000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(200);
    }
  });

  test("returns 0 for non-positive caps", () => {
    expect(jitteredBackoffMs(0)).toBe(0);
    expect(jitteredBackoffMs(-5)).toBe(0);
    expect(jitteredBackoffMs(Number.NaN)).toBe(0);
  });
});

describe("runProviderFailover", () => {
  test("returns the first accepted result", async () => {
    const invoke = vi.fn(async () => ({ text: "hi" }));
    const handleAttempt = vi.fn(async (_p: string, r: unknown) => !!r);
    const result = await runProviderFailover({
      providers: ["a"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      invoke,
      handleAttempt,
    });
    expect(result).toEqual({ text: "hi" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("fails over to the next provider when handleAttempt rejects", async () => {
    const invoke = vi.fn(async (name: string) =>
      name === "a" ? null : { text: "b" },
    );
    const result = await runProviderFailover({
      providers: ["a", "b"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toEqual({ text: "b" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("skips providers via shouldSkip", async () => {
    const invoke = vi.fn(async (name: string) => ({ text: name }));
    const result = await runProviderFailover({
      providers: ["a", "b"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      shouldSkip: async (name) => name === "a",
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toEqual({ text: "b" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("b", expect.anything());
  });

  test("does not retry non-retryable thrown errors — fails over immediately", async () => {
    deterministicRandom();
    const invoke = vi.fn(async (name: string) => {
      if (name === "a") throw new Error("schema boom");
      return { text: "b" };
    });
    const result = await runProviderFailover({
      providers: ["a", "b"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toEqual({ text: "b" });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toBe("a");
    expect(invoke.mock.calls[1][0]).toBe("b");
  });

  test("retries a transient thrown error once on the same provider then succeeds", async () => {
    deterministicRandom();
    let calls = 0;
    const invoke = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed");
      return { text: "recovered" };
    });
    const result = await runProviderFailover({
      providers: ["a"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toEqual({ text: "recovered" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("retries once then fails over when the error persists", async () => {
    deterministicRandom();
    const invoke = vi.fn(async (_name: string) => {
      throw new Error("fetch failed");
    });
    const result = await runProviderFailover({
      providers: ["a", "b"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toBeNull();

    expect(invoke).toHaveBeenCalledTimes(4);
  });

  test("respects maxRetries = 0 (no same-provider retry on transient errors)", async () => {
    deterministicRandom();
    const invoke = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const result = await runProviderFailover({
      providers: ["a"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      maxRetries: 0,
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("rethrows client aborts without retrying", async () => {
    deterministicRandom();
    const invoke = vi.fn(async () => {
      throw new Error(CLIENT_ABORTED);
    });
    await expect(
      runProviderFailover({
        providers: ["a", "b"],
        signal: signal(),
        totalMs: 10_000,
        route: "test",
        invoke,
        handleAttempt: async (_p, r) => !!r,
      }),
    ).rejects.toThrow(CLIENT_ABORTED);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("propagates a client abort when the client disconnects mid-invoke and the provider resolves null", async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => {
      controller.abort();
      return null;
    });
    await expect(
      runProviderFailover({
        providers: ["a", "b"],
        signal: controller.signal,
        totalMs: 10_000,
        route: "test",
        invoke,
        handleAttempt: async (_p, r) => !!r,
      }),
    ).rejects.toThrow(CLIENT_ABORTED);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("reclassifies an AbortError caused by the client disconnect as CLIENT_ABORTED", async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await expect(
      runProviderFailover({
        providers: ["a", "b"],
        signal: controller.signal,
        totalMs: 10_000,
        route: "test",
        invoke,
        handleAttempt: async (_p, r) => !!r,
      }),
    ).rejects.toThrow(CLIENT_ABORTED);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("reports thrown errors through onAttemptError with the attempt ordinal", async () => {
    deterministicRandom();
    const onAttemptError = vi.fn();
    const invoke = vi.fn(async (name: string) => {
      if (name === "a") throw new Error("fetch failed");
      return { text: "b" };
    });
    await runProviderFailover({
      providers: ["a", "b"],
      signal: signal(),
      totalMs: 10_000,
      route: "test",
      invoke,
      handleAttempt: async (_p, r) => !!r,
      onAttemptError,
    });
    expect(onAttemptError).toHaveBeenCalledTimes(2);
    expect(onAttemptError.mock.calls[0][0]).toBe("a");
    expect(onAttemptError.mock.calls[0][2]).toBe(1);
    expect(onAttemptError.mock.calls[1][2]).toBe(2);
  });

  test("does not retry once the remaining budget is too small", async () => {
    deterministicRandom();
    const invoke = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const result = await runProviderFailover({
      providers: ["a"],
      signal: signal(),
      totalMs: 500,
      route: "test",
      minRetryBudgetMs: 10_000,
      invoke,
      handleAttempt: async (_p, r) => !!r,
    });
    expect(result).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
