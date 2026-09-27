import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EkweError } from "@/constants/errors";
import { err } from "@/types/Result";
import { AnalyticsEvents } from "@/utils/analytics";

import { translateText } from "@/services/translateText";

const getSessionMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());
const breadcrumbMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

vi.mock("@/utils/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/logger")>();
  return {
    ...actual,
    addSentryBreadcrumb: breadcrumbMock,
  };
});

vi.mock("@/utils/http", () => ({
  getWorkerUrl: vi.fn(() => "https://worker.test"),
  fetchWithRetry: vi.fn(),
  mapWorkerError: vi.fn((_code: string, fallback: string) => fallback),
  isOfflineNetworkError: vi.fn(() => false),
  isTimeoutError: vi.fn(() => false),
}));

vi.mock("@/utils/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/analytics")>();
  return { ...actual, track: trackMock };
});

import {
  fetchWithRetry,
  getWorkerUrl,
  isOfflineNetworkError,
  isTimeoutError,
} from "@/utils/http";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const validResponse = {
  translation: "Hola",
  transliteration: "Hola",
  language: "es",
  provider: "openai",
};

beforeEach(() => {
  vi.mocked(getSessionMock).mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  vi.mocked(getWorkerUrl).mockReturnValue("https://worker.test");
  vi.mocked(fetchWithRetry).mockReset();
  vi.mocked(isOfflineNetworkError).mockReturnValue(false);
  vi.mocked(isTimeoutError).mockReturnValue(false);
  trackMock.mockClear();
  breadcrumbMock.mockClear();
});

describe("translateText", () => {
  it("fails fast on empty text without hitting the network", async () => {
    const result = await translateText("   ", "auto", "en");
    expect(result).toEqual(err(EkweError.EMPTY_TRANSCRIPT));
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("rejects when no worker URL is configured", async () => {
    vi.mocked(getWorkerUrl).mockReturnValue("");
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("fails client-side when the payload violates the shared schema", async () => {
    const result = await translateText("x".repeat(10_001), "auto", "en");
    expect(result).toEqual(err(EkweError.TRANSLATION_FAIL));
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("returns the translation on success", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse(validResponse));
    const result = await translateText("hello", "auto", "en");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        translation: "Hola",
        transliteration: "Hola",
        language: "es",
        sourceLang: "auto",
        targetLang: "en",
        provider: "openai",
      });
    }
    expect(fetchWithRetry).toHaveBeenCalledWith(
      "https://worker.test/translate",
      expect.objectContaining({
        retries: 2,
        timeout: 60000,
        retryOnHttpResponse: false,
      }),
    );
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_COMPLETED,
      {
        sourceLang: "auto",
        targetLang: "en",
        provider: "openai",
        chars: 5,
      },
    );
  });

  it("rejects a whitespace-only translation", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ ...validResponse, translation: "   " }),
    );
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.TRANSLATION_FAIL));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "empty_translation" }),
    );
  });

  it("rejects a response that fails the shared schema", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse({ foo: "bar" }));
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.TRANSLATION_FAIL));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "invalid_response" }),
    );
  });

  it("maps a 429 quota-exceeded to QUOTA_EXCEEDED", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED }, 429),
    );
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.QUOTA_EXCEEDED));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "quota_exceeded" }),
    );
  });

  it("maps a 429 rate-limit to RATE_LIMITED", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: WORKER_ERROR_CODES.EKWE_RATE_LIMIT }, 429),
    );
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.RATE_LIMITED));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "rate_limited" }),
    );
  });

  it("maps a generic worker error to TRANSLATION_FAIL", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: "EKWE_TRANSLATION_FAIL" }, 500),
    );
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.TRANSLATION_FAIL));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "worker_error" }),
    );
  });

  it("maps an offline rejection to NETWORK_LOST quietly", async () => {
    const offlineError = new Error("Device is offline");
    vi.mocked(fetchWithRetry).mockRejectedValue(offlineError);
    vi.mocked(isOfflineNetworkError).mockImplementation(
      (e) => e === offlineError,
    );
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "offline" }),
    );
  });

  it("maps a timeout to TRANSLATION_FAIL", async () => {
    const timeoutError = new Error("Request timed out");
    vi.mocked(fetchWithRetry).mockRejectedValue(timeoutError);
    vi.mocked(isTimeoutError).mockImplementation((e) => e === timeoutError);
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.TRANSLATION_FAIL));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "timeout" }),
    );
  });

  it("re-throws caller aborts", async () => {
    const abort = new Error("Aborted");
    abort.name = "AbortError";
    vi.mocked(fetchWithRetry).mockRejectedValue(abort);
    await expect(translateText("hello", "auto", "en")).rejects.toBe(abort);
  });

  it("maps a generic network failure to NETWORK_LOST", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error("socket hang up"));
    const result = await translateText("hello", "auto", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
    expect(trackMock).toHaveBeenCalledWith(
      AnalyticsEvents.TRANSLATION_FAILED,
      expect.objectContaining({ reason: "network_error" }),
    );
  });

  it("sends the session token in the Authorization header", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse(validResponse));
    await translateText("hello", "auto", "en");
    expect(fetchWithRetry).toHaveBeenCalledWith(
      "https://worker.test/translate",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-abc" }),
      }),
    );
  });
});

/**
 * scrubSentryEvent drops breadcrumb `data` before the event leaves the device,
 * so the status and worker error code have to survive in the message or a
 * production translation failure is undiagnosable.
 */
describe("translateText Sentry breadcrumbs", () => {
  // addSentryBreadcrumb takes positional args: (category, message, data).
  const breadcrumb = (): { category: string; message: string } => {
    const call = breadcrumbMock.mock.calls.at(-1);
    if (!call) throw new Error("expected a Sentry breadcrumb");
    return { category: call[0] as string, message: call[1] as string };
  };

  it("records the status and worker error code in the message", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: "EKWE_MT_UNAVAILABLE" }, 503),
    );
    await translateText("hola", "es", "en");
    expect(breadcrumb().category).toBe("translate");
    expect(breadcrumb().message).toContain("worker_error");
    expect(breadcrumb().message).toContain("status=503");
    expect(breadcrumb().message).toContain("errorCode=EKWE_MT_UNAVAILABLE");
  });

  it("records the language pair so a one-language outage is visible", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: "EKWE_TRANSLATION_FAIL" }, 500),
    );
    await translateText("hola", "es", "en");
    expect(breadcrumb().message).toContain("es->en");
  });

  it("records quota and rate-limit outcomes distinctly", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED }, 429),
    );
    await translateText("hola", "es", "en");
    expect(breadcrumb().message).toContain("quota_exceeded");
    expect(breadcrumb().message).toContain("status=429");

    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse({}, 429));
    await translateText("hola", "es", "en");
    expect(breadcrumb().message).toContain("rate_limited");
  });

  it("records the provider that returned nothing", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ ...validResponse, translation: "   " }),
    );
    await translateText("hola", "es", "en");
    expect(breadcrumb().message).toContain("empty_translation");
    expect(breadcrumb().message).toContain("provider=openai");
  });

  it("records the rejection type but never the rejection message", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(
      new TypeError("fetch failed for https://worker.test/translate?key=abc"),
    );
    await translateText("hola", "es", "en");
    expect(breadcrumb().message).toContain("network_error");
    expect(breadcrumb().message).toContain("kind=TypeError");
    expect(breadcrumb().message).not.toContain("key=abc");
  });

  it("does not breadcrumb a successful translation", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse(validResponse));
    await translateText("hello", "en", "es");
    expect(breadcrumbMock).not.toHaveBeenCalled();
  });
});
