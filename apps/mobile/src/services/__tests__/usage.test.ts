import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchUsage } from "../usage";

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

vi.mock("@/utils/networkUtils", () => ({
  getWorkerUrl: vi.fn(() => "https://worker.test"),
  fetchWithRetry: vi.fn(),
  isTimeoutError: vi.fn(() => false),
}));

import {
  fetchWithRetry,
  getWorkerUrl,
  isTimeoutError,
} from "@/utils/networkUtils";

const validSnapshot = {
  day: "2026-09-17",
  resetsAt: 1729200000000,
  translate: { used: 1, total: 10, remaining: 9 },
  transcribe: { used: 0, total: 3, remaining: 3 },
  tts: { used: 2, total: 5, remaining: 3 },
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.mocked(getWorkerUrl).mockReturnValue("https://worker.test");
  vi.mocked(getSessionMock).mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  vi.mocked(fetchWithRetry).mockReset();
  vi.mocked(isTimeoutError).mockReturnValue(false);
});

describe("fetchUsage", () => {
  it("returns an error when no worker URL is configured", async () => {
    vi.mocked(getWorkerUrl).mockReturnValue("");
    const result = await fetchUsage();
    expect(result).toEqual({ ok: false, error: "Worker URL not configured" });
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("fetches without an Authorization header when signed out", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse(validSnapshot));
    const result = await fetchUsage();
    expect(result).toEqual({ ok: true, value: validSnapshot });
    expect(fetchWithRetry).toHaveBeenCalledWith("https://worker.test/usage", {
      method: "GET",
      headers: {},
      retries: 1,
      timeout: 15000,
    });
  });

  it("sends the session token when signed in", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse(validSnapshot));
    await fetchUsage();
    expect(fetchWithRetry).toHaveBeenCalledWith(
      "https://worker.test/usage",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-123" },
      }),
    );
  });

  it("surfaces a non-ok server response", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    const result = await fetchUsage();
    expect(result).toEqual({ ok: false, error: "Server returned 500" });
  });

  it("rejects a payload that fails the shared schema", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ day: "nope", translate: {} }),
    );
    const result = await fetchUsage();
    expect(result).toEqual({ ok: false, error: "Invalid usage payload" });
  });

  it("reports a timeout", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error("timed out"));
    vi.mocked(isTimeoutError).mockReturnValue(true);
    const result = await fetchUsage();
    expect(result).toEqual({ ok: false, error: "Timed out" });
  });

  it("reports a generic network error", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error("socket hang up"));
    const result = await fetchUsage();
    expect(result).toEqual({ ok: false, error: "Network error" });
  });

  it("coerces a non-Error rejection", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue("down");
    const result = await fetchUsage();
    expect(result).toEqual({ ok: false, error: "Network error" });
  });
});
