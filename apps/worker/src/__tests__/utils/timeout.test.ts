import { afterEach, describe, expect, test, vi } from "vitest";
import { withTimeout } from "@/utils/timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withTimeout (utils/timeout.ts)", () => {
  test("resolves when the open wins and clears the pending connect timer + abort listener", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const addSpy = vi.spyOn(signal, "addEventListener");
    const removeSpy = vi.spyOn(signal, "removeEventListener");

    const result = withTimeout(5_000, "connect", signal, async () => ({
      ok: true,
    }));

    await expect(result).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects on timeout and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const p = withTimeout(
      1_000,
      "connect",
      signal,
      () => new Promise(() => {}),
    );
    const assertion = expect(p).rejects.toThrow(
      "connect timed out after 1000ms",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  test("rejects on abort mid-connect, clears the timer, and removes the abort listener", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const signal = controller.signal;
    const removeSpy = vi.spyOn(signal, "removeEventListener");

    const p = withTimeout(
      5_000,
      "connect",
      signal,
      () => new Promise(() => {}),
    );
    controller.abort();
    await expect(p).rejects.toThrow("connect aborted");
    expect(vi.getTimerCount()).toBe(0);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects immediately for an already-aborted signal without invoking open", async () => {
    const controller = new AbortController();
    controller.abort();
    const open = vi.fn(async () => ({ ok: true }));
    await expect(
      withTimeout(100, "connect", controller.signal, open),
    ).rejects.toThrow("connect aborted");
    expect(open).not.toHaveBeenCalled();
  });

  test("propagates an upstream open failure and cleans up", async () => {
    const signal = new AbortController().signal;
    const removeSpy = vi.spyOn(signal, "removeEventListener");
    await expect(
      withTimeout(100, "connect", signal, async () => {
        throw new Error("upstream boom");
      }),
    ).rejects.toThrow("upstream boom");
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
