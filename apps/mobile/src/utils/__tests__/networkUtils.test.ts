import { WORKER_ERROR_CODES } from "@ekwe/shared";

import { EkweError } from "@/constants/errors";
import {
  fetchWithRetry,
  mapWorkerError,
  OfflineNetworkError,
  TimeoutError,
  isTimeoutError,
} from "../networkUtils";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getNetworkStatus,
  isDefinitelyOffline,
  networkActions,
} from "@/store/network";

vi.mock("@/services/mmkv", () => ({
  mmkv: { getString: vi.fn(), set: vi.fn(), getBoolean: vi.fn() },
}));

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { refreshSession: vi.fn() } },
}));

afterEach(() => {
  networkActions.set({ isConnected: null, isInternetReachable: null });
});

describe("mapWorkerError", () => {
  it("maps transcription worker codes", () => {
    expect(mapWorkerError("EKWE_NETWORK_LOST")).toBe(EkweError.NETWORK_LOST);
    expect(mapWorkerError("EKWE_SHARE_COPY_FAIL")).toBe(
      EkweError.SHARE_COPY_FAIL,
    );
    expect(mapWorkerError("EKWE_EMPTY_TRANSCRIPT")).toBe(
      EkweError.EMPTY_TRANSCRIPT,
    );
    expect(mapWorkerError("EKWE_TRANSCRIPTION_FAIL")).toBe(
      EkweError.TRANSCRIPTION_FAIL,
    );
    expect(mapWorkerError("EKWE_TRANSCRIBE_TIMEOUT")).toBe(
      EkweError.TRANSCRIBE_TIMEOUT,
    );
    expect(mapWorkerError(WORKER_ERROR_CODES.FILE_TOO_LARGE)).toBe(
      EkweError.FILE_TOO_LARGE,
    );
    expect(mapWorkerError(WORKER_ERROR_CODES.AUDIO_TOO_LONG)).toBe(
      EkweError.AUDIO_TOO_LONG,
    );
  });

  it("maps all-providers-fail", () => {
    expect(mapWorkerError(WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL)).toBe(
      EkweError.ALL_PROVIDERS_FAIL,
    );
  });

  it("maps the canonical rate-limit spelling only", () => {
    expect(mapWorkerError(WORKER_ERROR_CODES.EKWE_RATE_LIMIT)).toBe(
      EkweError.RATE_LIMITED,
    );
    // The legacy EKWE_RATE_LIMITED spelling was never emitted by the worker
    // and is no longer matched — it falls through to the default.
    expect(mapWorkerError("EKWE_RATE_LIMITED" as string)).toBe(
      EkweError.SERVER_ERROR,
    );
    expect(EkweError.RATE_LIMITED).toBe(WORKER_ERROR_CODES.EKWE_RATE_LIMIT);
  });

  it("maps translation codes", () => {
    expect(mapWorkerError("EKWE_TRANSLATION_FAIL")).toBe(
      EkweError.TRANSLATION_FAIL,
    );
    expect(mapWorkerError("EKWE_SERVER_ERROR")).toBe(EkweError.SERVER_ERROR);
  });

  it("falls back on unknown codes", () => {
    expect(mapWorkerError("EKWE_BOGUS")).toBe(EkweError.SERVER_ERROR);
    expect(mapWorkerError("EKWE_BOGUS", EkweError.TRANSCRIPTION_FAIL)).toBe(
      EkweError.TRANSCRIPTION_FAIL,
    );
  });
});

describe("tri-state network store", () => {
  it("treats null probes as unknown, not offline", () => {
    expect(isDefinitelyOffline()).toBe(false);
    expect(getNetworkStatus()).toBe("unknown");
  });

  it("reports a definitive disconnect as offline", () => {
    networkActions.set({ isConnected: false, isInternetReachable: null });
    expect(isDefinitelyOffline()).toBe(true);
    expect(getNetworkStatus()).toBe("offline");
    networkActions.set({ isConnected: true, isInternetReachable: false });
    expect(isDefinitelyOffline()).toBe(true);
  });

  it("reports a live reachable connection as online", () => {
    networkActions.set({ isConnected: true, isInternetReachable: true });
    expect(isDefinitelyOffline()).toBe(false);
    expect(getNetworkStatus()).toBe("online");
  });
});

describe("fetchWithRetry offline fail-fast", () => {
  it("rejects with OfflineNetworkError without calling fetch when offline", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    networkActions.set({ isConnected: false, isInternetReachable: false });

    await expect(fetchWithRetry("https://example.com")).rejects.toBeInstanceOf(
      OfflineNetworkError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("isOfflineNetworkError recognizes the marker error", () => {
    expect(new OfflineNetworkError().name).toBe("OfflineNetworkError");
  });
});

describe("fetchWithRetry timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws TimeoutError when a request exceeds the timeout", async () => {
    vi.useFakeTimers();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, opts) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = opts?.signal as AbortSignal;
          if (signal.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          signal.addEventListener("abort", () => reject(new Error("Aborted")));
        }),
    );

    const promise = fetchWithRetry("https://example.com", {
      timeout: 1000,
      retries: 3,
      backoff: 1,
    });

    vi.advanceTimersByTime(1000);

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(error)).toBe(true);

    fetchSpy.mockRestore();
  });

  it("does not retry a timed-out request", async () => {
    vi.useFakeTimers();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, opts) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = opts?.signal as AbortSignal;
          if (signal.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          signal.addEventListener("abort", () => reject(new Error("Aborted")));
        }),
    );

    const promise = fetchWithRetry("https://example.com", {
      timeout: 1000,
      retries: 3,
      backoff: 1,
    });

    vi.advanceTimersByTime(5000);

    await promise.catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });
});
