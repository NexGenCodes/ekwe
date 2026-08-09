import { EkweError } from "@/constants/errors";
import {
  fetchWithRetry,
  mapWorkerError,
  OfflineNetworkError,
} from "../networkUtils";
import {
  getNetworkStatus,
  isDefinitelyOffline,
  networkActions,
} from "@/store/network";

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
    expect(mapWorkerError("EKWE_FILE_TOO_LARGE")).toBe(
      EkweError.FILE_TOO_LARGE,
    );
  });

  it("accepts both spellings of all-providers-fail", () => {
    expect(mapWorkerError("EKWE_ALL_PROVIDERS_FAIL")).toBe(
      EkweError.ALL_PROVIDERS_FAIL,
    );
    expect(mapWorkerError("ALL_PROVIDERS_FAILED")).toBe(
      EkweError.ALL_PROVIDERS_FAIL,
    );
  });

  it("accepts both spellings of rate-limit", () => {
    expect(mapWorkerError("EKWE_RATE_LIMITED")).toBe(EkweError.RATE_LIMITED);
    expect(mapWorkerError("EKWE_RATE_LIMIT")).toBe(EkweError.RATE_LIMITED);
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
    const fetchSpy = jest.spyOn(globalThis, "fetch");
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