import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EkweError } from "@/constants/errors";
import { err } from "@/types/Result";

import { synthesizeAudio, synthesizeSpeech } from "@/services/speech";

const getSessionMock = vi.hoisted(() => vi.fn());
const getWorkerUrlMock = vi.hoisted(() => vi.fn());
const uploadMultipartMock = vi.hoisted(() => vi.fn());
const transcodeMock = vi.hoisted(() => vi.fn());

const fsMock = vi.hoisted(() => ({
  exists: true,
  size: 1024,
  written: [] as Uint8Array[],
}));

const networkMock = vi.hoisted(() => {
  class TimeoutError extends Error {
    constructor() {
      super("Request timed out");
      this.name = "TimeoutError";
    }
  }
  return { TimeoutError };
});

vi.mock("expo-file-system", () => {
  class MockFile {
    exists = fsMock.exists;
    size = fsMock.size;
    create = vi.fn();
    delete = vi.fn();
    write = vi.fn((bytes: Uint8Array): void => {
      fsMock.written.push(bytes);
    });
    constructor(public uri: string) {}
  }
  return {
    File: MockFile,
    UploadType: { MULTIPART: "multipart" },
    Paths: { cache: { uri: "file:///cache/" } },
  };
});

vi.mock("@/services/audioTranscoder", () => ({
  AudioTranscoder: { transcodeToOpus: transcodeMock },
}));

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

vi.mock("@/utils/http", () => ({
  getWorkerUrl: getWorkerUrlMock,
  mapWorkerError: vi.fn((_code: string, fallback: string) => fallback),
  TimeoutError: networkMock.TimeoutError,
  isTimeoutError: vi.fn((e: unknown) => e instanceof networkMock.TimeoutError),
  // The audio fetch goes through the shared retry helper; these tests pin the
  // single-attempt behaviour by driving `globalThis.fetch` directly.
  fetchWithRetry: (url: string, init?: RequestInit) => fetch(url, init),
}));

vi.mock("@/services/uploadMultipart", () => ({
  uploadMultipart: uploadMultipartMock,
  getMimeType: vi.fn((ext: string) =>
    ext === "wav" ? "audio/wav" : "audio/ogg",
  ),
}));

import { MAX_AUDIO_BYTES, PREMIUM_LIMITS } from "@ekwe/shared/plans";

import { Paths } from "expo-file-system";

import { networkActions } from "@/store/network";
import { settingsActions } from "@/store/settings";

const JSON_HEADERS = { "content-type": "application/json" };

const AUDIO_KEY =
  "speech:1111111111111111111111111111111111111111111111111111111111111111:standard:auto:free:cache:en:2222222222222222222222222222222222222222222222222222222222222222";
const AUDIO_PATH = `/speech/${AUDIO_KEY}`;

const audioJsonResponse = (
  mime = "audio/wav",
  status = 200,
  extra: Record<string, unknown> = {},
): Response =>
  new Response(
    status >= 400
      ? JSON.stringify({ error: "EKWE_SPEECH_FAIL" })
      : JSON.stringify({
          audioUrl: AUDIO_PATH,
          mime,
          sourceLang: "en",
          targetLang: "en",
          translated: false,
          voiceId: "standard",
          ...extra,
        }),
    { status, headers: JSON_HEADERS },
  );

/**
 * Synthesis is two requests now: a POST returning metadata plus an audio URL,
 * then a GET on that URL for the bytes. Route on the path so one spy can answer
 * both without a call-order assumption.
 */
const mockSynthFetch = (
  mime = "audio/wav",
  status = 200,
  extra: Record<string, unknown> = {},
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).includes("/speech/")
      ? new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
          headers: { "content-type": mime },
        })
      : audioJsonResponse(mime, status, extra),
  );

/**
 * Synthesis makes a POST and then a bodyless GET for the audio, so assertions
 * about the request have to look at the POST specifically rather than the most
 * recent call.
 */
const synthCall = (): [unknown, RequestInit | undefined] => {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([input]) => !String(input).includes("/speech/"));
  if (!call) throw new Error("expected a /synthesize call");
  return call as [unknown, RequestInit | undefined];
};

const fetchBody = (): Record<string, unknown> => {
  const [, init] = synthCall();
  return JSON.parse(init?.body as string) as Record<string, unknown>;
};

const expectRiffBytes = (): void => {
  expect(fsMock.written.at(-1)).toEqual(
    new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  );
};

beforeEach(() => {
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  getWorkerUrlMock.mockReset();
  getWorkerUrlMock.mockReturnValue("https://worker.test");
  uploadMultipartMock.mockReset();
  transcodeMock.mockReset();
  transcodeMock.mockResolvedValue({
    ok: true,
    value: {
      uri: "file:///cache/ekwe_converted_test.ogg",
      durationMs: 1234,
      waveform: [0.12, 0.4, 0.8],
    },
  });
  fsMock.exists = true;
  fsMock.size = 1024;
  (Paths.cache as { uri: string }).uri = "file:///cache/";
  fsMock.written = [];
});

afterEach(() => {
  networkActions.set({ isConnected: null, isInternetReachable: null });
  settingsActions.setVoiceGender("default");
  settingsActions.setVoiceId(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("synthesizeSpeech", () => {
  it("rejects empty text", async () => {
    const result = await synthesizeSpeech("   ", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
  });

  it("rejects text over the shared char limit", async () => {
    const result = await synthesizeSpeech("x".repeat(2401), "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
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

  it("normalizes provider audio to Ogg/Opus and returns the waveform", async () => {
    const fetchSpy = mockSynthFetch("audio/wav");
    const result = await synthesizeSpeech("hello", "en");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : null).toMatchObject({
      uri: "file:///cache/ekwe_converted_test.ogg",
      durationMs: 1234,
      waveform: [0.12, 0.4, 0.8],
    });
    expect(fetchBody()).toMatchObject({ text: "hello", targetLang: "en" });
    expect(fetchBody().gender).toBeUndefined();
    expect(fetchBody().voiceId).toBeUndefined();

    expectRiffBytes();
    expect(transcodeMock).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/ekwe_speech_.*\.wav$/),
    );
    fetchSpy.mockRestore();
  });

  it("falls back to the raw provider file when normalization fails", async () => {
    transcodeMock.mockResolvedValue({
      ok: false,
      error: EkweError.PROCESSOR_FAIL,
    });
    const fetchSpy = mockSynthFetch("audio/wav");
    const result = await synthesizeSpeech("hello", "en");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uri).toMatch(
        /^file:\/\/\/cache\/ekwe_speech_.*\.wav$/,
      );
      expect(result.value.waveform).toBeUndefined();
    }
    fetchSpy.mockRestore();
  });

  it("sends the session token when signed in", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-zzz" } },
      error: null,
    });
    const fetchSpy = mockSynthFetch("audio/wav");
    await synthesizeSpeech("hello", "en");
    const init = synthCall()[1] as RequestInit;
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token-zzz",
    });
    fetchSpy.mockRestore();
  });

  it("maps the voiceGender setting to the wire gender field", async () => {
    settingsActions.setVoiceGender("male");
    const fetchSpy = mockSynthFetch("audio/wav");
    await synthesizeSpeech("hello", "en");
    expect(fetchBody().gender).toBe("male");
    fetchSpy.mockRestore();
  });

  it("sends the stored voiceId, and an explicit option overrides it", async () => {
    settingsActions.setVoiceId("studio");
    const fetchSpy = mockSynthFetch("audio/wav");
    await synthesizeSpeech("hello", "en");
    expect(fetchBody().voiceId).toBe("studio");

    await synthesizeSpeech("hello", "en", { voiceId: "studio" });
    expect(fetchBody().voiceId).toBe("studio");
    fetchSpy.mockRestore();
  });

  it("normalizes mp3 provider audio through the transcoder", async () => {
    const fetchSpy = mockSynthFetch("audio/mpeg");
    const result = await synthesizeSpeech("hello", "en");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uri).toBe("file:///cache/ekwe_converted_test.ogg");
    }
    expect(transcodeMock).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/ekwe_speech_.*\.mp3$/),
    );
    fetchSpy.mockRestore();
  });

  it("rejects an invalid response body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
        headers: JSON_HEADERS,
      }),
    );
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
    fetchSpy.mockRestore();
  });

  it("rejects a 200 response whose body is not JSON", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("not json at all", { status: 200 }));
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
    fetchSpy.mockRestore();
  });

  it("rejects when the metadata parses but the audio GET fails", async () => {
    // The synth POST succeeded; the follow-up GET for the bytes is what failed.
    // Synthesis is all-or-nothing here, so this must not resolve to a partial
    // result and must not touch the transcoder.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input).includes("/speech/")
          ? new Response("gone", { status: 404 })
          : audioJsonResponse(),
      );
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
    expect(transcodeMock).not.toHaveBeenCalled();
    expect(fsMock.written).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("rejects when the audio GET returns an empty body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input).includes("/speech/")
          ? new Response(new Uint8Array([]), { status: 200 })
          : audioJsonResponse(),
      );
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
    expect(fsMock.written).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("falls back to SPEECH_FAIL on a non-ok response with a worker error body", async () => {
    const fetchSpy = mockSynthFetch("audio/wav", 500);
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
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

  it("maps a non-Error fetch rejection to NETWORK_LOST", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue("boom" as unknown as Error);
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
    fetchSpy.mockRestore();
  });

  it("defaults the error code when the error body is not JSON", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("oops", { status: 500 }));
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
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

    // Let the event loop cycle so the timeout gets registered
    await vi.advanceTimersByTimeAsync(1);
    vi.runAllTimers();

    const result = await promise;
    expect(result).toEqual(err(EkweError.INTERRUPTED));
    fetchSpy.mockRestore();
  });

  it("rejects when the cache directory is unavailable", async () => {
    (Paths.cache as { uri: string }).uri = "";
    const fetchSpy = mockSynthFetch("audio/wav");
    const result = await synthesizeSpeech("hello", "en");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
    fetchSpy.mockRestore();
  });
});

describe("synthesizeAudio", () => {
  const source = { uri: "file:///tmp/rec.m4a", durationMs: 1500 };

  it("rejects when the recording file is missing", async () => {
    fsMock.exists = false;
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.SHARE_COPY_FAIL));
  });

  it("rejects an empty recording", async () => {
    fsMock.size = 0;
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.AUDIO_EMPTY));
  });

  it("rejects while offline", async () => {
    networkActions.set({ isConnected: false, isInternetReachable: false });
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
  });

  it("rejects a recording over the size limit", async () => {
    fsMock.size = MAX_AUDIO_BYTES + 1;
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.FILE_TOO_LARGE));
  });

  it("rejects a recording over the duration limit", async () => {
    const result = await synthesizeAudio(
      { ...source, durationMs: PREMIUM_LIMITS.dictationDurationMs + 1 },
      "en",
      "es",
    );
    expect(result).toEqual(err(EkweError.AUDIO_TOO_LONG));
  });

  it("rejects when no worker URL is configured", async () => {
    getWorkerUrlMock.mockReturnValue("");
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
  });

  it("uploads to /synthesize and returns the audio route", async () => {
    uploadMultipartMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        audioUrl: AUDIO_PATH,
        mime: "audio/wav",
        sourceLang: "en",
        targetLang: "es",
        translated: true,
        voiceId: "studio",
      }),
    });
    // The audio itself arrives on a second, bodyless GET.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        headers: { "content-type": "audio/wav" },
      }),
    );

    const result = await synthesizeAudio(source, "en", "es", {
      voiceId: "studio",
      gender: "female",
    });

    expect(uploadMultipartMock).toHaveBeenCalledTimes(1);
    const [file, url, opts] = uploadMultipartMock.mock.calls[0];
    expect(file.uri).toBe("file:///tmp/rec.m4a");
    expect(url).toBe("https://worker.test/synthesize");
    expect(opts.parameters).toMatchObject({
      lang: "en",
      targetLang: "es",
      duration: "1500",
      voiceId: "studio",
      gender: "female",
    });
    expect(opts.timeoutMs).toBe(28_000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        sourceLang: "en",
        targetLang: "es",
        translated: true,
        durationMs: 1234,
        waveform: [0.12, 0.4, 0.8],
      });
      expect(result.value.uri).toBe("file:///cache/ekwe_converted_test.ogg");
    }
    expect(transcodeMock).toHaveBeenCalledOnce();
  });

  it("reports the server-timing stages the worker returned", async () => {
    // The upload path logs server-timing under __DEV__ so slow stages show up
    // next to the request that caused them.
    uploadMultipartMock.mockResolvedValue({
      status: 200,
      headers: { "server-timing": "stt;dur=12, synth;dur=340" },
      body: JSON.stringify({
        audioUrl: AUDIO_PATH,
        mime: "audio/wav",
        sourceLang: "en",
        targetLang: "es",
        translated: true,
        voiceId: "studio",
      }),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        headers: { "content-type": "audio/wav" },
      }),
    );
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await synthesizeAudio(source, "en", "es");

    expect(result.ok).toBe(true);
    // logger.info prefixes the level, so the rendered line is the 2nd argument.
    expect(
      infoSpy.mock.calls.some((call) =>
        call
          .map(String)
          .join(" ")
          .includes("[Perf] synth server: stt=12 synth=340"),
      ),
    ).toBe(true);
    infoSpy.mockRestore();
  });

  it("maps an exhausted quota (429) to QUOTA_EXCEEDED", async () => {
    uploadMultipartMock.mockResolvedValue({
      status: 429,
      body: JSON.stringify({ error: "EKWE_QUOTA_EXCEEDED" }),
    });
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.QUOTA_EXCEEDED));
  });

  it("maps a 429 without a quota code to RATE_LIMITED", async () => {
    uploadMultipartMock.mockResolvedValue({
      status: 429,
      body: JSON.stringify({ error: "EKWE_RATE_LIMIT" }),
    });
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.RATE_LIMITED));
  });

  it("falls back to SPEECH_FAIL on other non-ok responses", async () => {
    uploadMultipartMock.mockResolvedValue({
      status: 503,
      body: JSON.stringify({ error: "EKWE_ALL_PROVIDERS_FAIL" }),
    });
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
  });

  it("rejects an invalid response body", async () => {
    uploadMultipartMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ nope: true }),
    });
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
  });

  it("reports TRANSCRIBE_TIMEOUT when the upload task times out", async () => {
    uploadMultipartMock.mockRejectedValue(new networkMock.TimeoutError());
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.TRANSCRIBE_TIMEOUT));
  });

  it("reports INTERRUPTED when the upload is aborted", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    uploadMultipartMock.mockRejectedValue(abortError);
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.INTERRUPTED));
  });

  it("maps an unexpected upload error to NETWORK_LOST", async () => {
    uploadMultipartMock.mockRejectedValue(new Error("socket closed"));
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
  });

  it("maps a non-Error upload rejection to NETWORK_LOST", async () => {
    uploadMultipartMock.mockRejectedValue("boom");
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.NETWORK_LOST));
  });

  it("defaults the error code when the audio error body is not JSON", async () => {
    uploadMultipartMock.mockResolvedValue({ status: 500, body: "oops" });
    const result = await synthesizeAudio(source, "en", "es");
    expect(result).toEqual(err(EkweError.SPEECH_FAIL));
  });
});
