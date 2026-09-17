import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EkweError } from "@/constants/errors";
import { err } from "@/types/Result";

import { synthesizeSpeech } from "../tts";

const getSessionMock = vi.hoisted(() => vi.fn());
const healProSessionMock = vi.hoisted(() => vi.fn());
const getWorkerUrlMock = vi.hoisted(() => vi.fn());

vi.mock("expo-file-system", () => {
  class MockFile {
    exists = false;
    create = vi.fn();
    write = vi.fn();
    constructor(public uri: string) {}
  }
  return { File: MockFile, Paths: { cache: { uri: "file:///cache/" } } };
});

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

vi.mock("@/utils/networkUtils", () => ({
  getWorkerUrl: getWorkerUrlMock,
  mapWorkerError: vi.fn((_code: string, fallback: string) => fallback),
  healProSession: healProSessionMock,
}));

import { Paths } from "expo-file-system";

import { networkActions } from "@/store/network";
import { settingsActions } from "@/store/settings";

const audioBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;

const audioResponse = (contentType: string, status = 200): Response =>
  new Response(audioBytes, {
    status,
    headers: { "content-type": contentType },
  });

const fetchBody = (): Record<string, unknown> => {
  const call = vi.mocked(fetch).mock.calls.at(-1)!;
  return JSON.parse(call[1]?.body as string) as Record<string, unknown>;
};

beforeEach(() => {
  vi.mocked(getSessionMock).mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  healProSessionMock.mockReset();
  healProSessionMock.mockResolvedValue(false);
  getWorkerUrlMock.mockReset();
  getWorkerUrlMock.mockReturnValue("https://worker.test");
  vi.restoreAllMocks();
});

afterEach(() => {
  networkActions.set({ isConnected: null, isInternetReachable: null });
  settingsActions.setTtsVoice("default");
  vi.useRealTimers();
});

describe("synthesizeSpeech", () => {
  it("rejects empty text", async () => {
    const result = await synthesizeSpeech("   ", "en");
    expect(result).toEqual(err(EkweError.TTS_FAIL));
  });

  it("rejects text over the shared char limit", async () => {
    const result = await synthesizeSpeech("x".repeat(1001), "en");
    expect(result).toEqual(err(EkweError.TTS_FAIL));
  });

  it("rejects while the device is definitively offline", async () => {
    networkActions.set({ isConnected: false, isInternetReachable: false });
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
  });

  it("rejects when no worker URL is configured", async () => {
    getWorkerUrlMock.mockReturnValue("");
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
  });

  it("writes the audio to a wav cache file on success", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(audioResponse("audio/wav"));
    const result = await synthesizeSpeech("hello", "en");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : null).toMatchObject({
      uri: expect.stringMatching(/^file:\/\/\/cache\/ekwe_tts_.*\.wav$/),
    });
    expect(fetchBody()).toMatchObject({ text: "hello", lang: "en" });
    expect(fetchBody().gender).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("sends the session token when signed in", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-zzz" } },
      error: null,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(audioResponse("audio/wav"));
    await synthesizeSpeech("hello", "en");
    const init = vi.mocked(fetch).mock.calls.at(-1)![1] as RequestInit;
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token-zzz",
    });
    fetchSpy.mockRestore();
  });

  it("maps the ttsVoice setting to the wire gender field", async () => {
    settingsActions.setTtsVoice("male");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(audioResponse("audio/wav"));
    await synthesizeSpeech("hello", "en");
    expect(fetchBody().gender).toBe("male");
    fetchSpy.mockRestore();
  });

  it("uses .mp3 when the response is mp3 audio", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(audioResponse("audio/mpeg"));
    const result = await synthesizeSpeech("hello", "en");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uri).toMatch(/\.mp3$/);
    }
    fetchSpy.mockRestore();
  });

  it("fails without retrying when a 403 does not heal the Pro session", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    healProSessionMock.mockResolvedValue(false);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(audioResponse("audio/wav", 403));
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.TTS_FAIL));
    expect(fetch).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("retries the request once when a 403 heals the Pro session", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    healProSessionMock.mockResolvedValue(true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(audioResponse("audio/wav", 403))
      .mockResolvedValueOnce(audioResponse("audio/wav"));
    const result = await synthesizeSpeech("hello", "en");
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it("falls back to TTS_FAIL on a non-ok response with a worker error body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "EKWE_TTS_FAIL" }), {
        status: 500,
      }),
    );
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.TTS_FAIL));
    fetchSpy.mockRestore();
  });

  it("maps a generic fetch failure to NETWORK_LOST", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("connection refused"));
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
    fetchSpy.mockRestore();
  });

  it("reports INTERRUPTED when the request times out", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, opts) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = opts?.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const e = new Error("Aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );

    const promise = synthesizeSpeech("hello", "en");
    // Let synthesizeSpeech reach the internal setTimeout (it awaits getSession first).
    await Promise.resolve();
    vi.advanceTimersByTime(26_000);
    const result = await promise;
    expect(result).toEqual(err(EkweError.INTERRUPTED));
    fetchSpy.mockRestore();
  });

  it("rejects when the cache directory is unavailable", async () => {
    (Paths.cache as { uri: string }).uri = "";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(audioResponse("audio/wav"));
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.TTS_FAIL));
    (Paths.cache as { uri: string }).uri = "file:///cache/";
    fetchSpy.mockRestore();
  });
});
