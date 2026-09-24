import { describe, test, expect } from "vitest";
import {
  getClientHeaders,
  fetchWithTimeout,
  abortableDelay,
} from "@/utils/fetch";
import { jsonResponse } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";

describe("getClientHeaders", () => {
  test("returns Accept-Language and never client-controlled IP headers", () => {
    const h = getClientHeaders();
    expect(h["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(h["User-Agent"]).toBeFalsy();
    expect(h["X-Forwarded-For"]).toBeFalsy();
    expect(h["X-Real-IP"]).toBeFalsy();
  });
});

describe("fetchWithTimeout", () => {
  test("resolves on success before timeout", async () => {
    server.use(
      http.get("https://mock.test/200", () => jsonResponse({ ok: true })),
    );
    const res = await fetchWithTimeout(
      "https://mock.test/200",
      { method: "GET" },
      5000,
      new AbortController().signal,
    );
    expect(res.ok).toBe(true);
  });

  test("aborts on client signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithTimeout(
        "https://httpstat.us/200",
        { method: "GET" },
        5000,
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

describe("abortableDelay", () => {
  test("resolves after delay", async () => {
    const start = Date.now();
    await abortableDelay(10, new AbortController().signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  test("throws on abort", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(1000, controller.signal)).rejects.toThrow(
      "CLIENT_ABORTED",
    );
  });
});
