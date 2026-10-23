import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { EkweError, ErrorMessages } from "@/constants/errors";
import {
  dictationActions,
  dictation$,
  INITIAL_STATE,
} from "@/store/dictationStore";

const capture = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  isRecording: vi.fn(),
  addPcmChunkListener: vi.fn(() => () => undefined),
}));

const stream = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  addCallback: vi.fn(() => () => undefined),
  sendPcm: vi.fn(),
}));

const batch = vi.hoisted(() => ({
  transcribe: vi.fn(),
}));

const audio = vi.hoisted(() => ({
  setSessionId: vi.fn(),
  setSourceLang: vi.fn(),
  setRecordingState: vi.fn(),
  setDuration: vi.fn(),
  appendTranscript: vi.fn(),
  setError: vi.fn(),
  resetAudioState: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  getToken: vi.fn(() => "test-token"),
}));

const backend = vi.hoisted(() => ({
  ensureAccessToken: vi.fn(async () => "test-token" as string | null),
}));

const usage = vi.hoisted(() => ({
  invalidate: vi.fn(),
  snapshot: undefined as unknown,
}));

const analytics = vi.hoisted(() => ({
  track: vi.fn(),
}));

const fileMock = vi.hoisted(() => ({
  deletes: vi.fn(),
}));

vi.mock("@/services/audioCapture", () => ({ AudioCapture: capture }));
vi.mock("@/services/streamTranscriber", () => ({ StreamTranscriber: stream }));
vi.mock("@/services/batchTranscriber", () => ({ batchTranscriber: batch }));
vi.mock("@/store", () => ({
  audioActions: audio,
  RecordingState: {
    Idle: "idle",
    Recording: "recording",
    Processing: "processing",
    Done: "done",
    Error: "error",
  },
}));
vi.mock("@/store/auth", () => ({
  getToken: auth.getToken,
  auth$: { isPro: { peek: () => true } },
}));
vi.mock("@/services/backend", () => ({
  ensureAccessToken: backend.ensureAccessToken,
}));
vi.mock("@/hooks/queries/useUsageQuery", () => ({
  invalidateUsage: usage.invalidate,
  usage$: { get: () => usage.snapshot },
}));
vi.mock("@/utils/analytics", () => ({
  AnalyticsEvents: {
    DICTATION_STARTED: "dictation_started",
    DICTATION_CANCELLED: "dictation_cancelled",
    TRANSCRIBING_STARTED: "transcribing_started",
    TRANSCRIBING_COMPLETED: "transcribing_completed",
    TRANSCRIPTION_FAILED: "transcription_failed",
  },
  track: analytics.track,
}));
vi.mock("@/utils", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/utils/http", () => ({
  getWorkerUrl: vi.fn(() => "wss://worker/kw"),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    exists = true;
    delete = fileMock.deletes;
  },
}));

beforeEach(() => {
  dictation$.set({ ...INITIAL_STATE });
  usage.snapshot = undefined;
  vi.clearAllMocks();
  capture.requestPermission.mockResolvedValue({ ok: true });
  capture.startRecording.mockResolvedValue({ ok: true });
  capture.stopRecording.mockResolvedValue({ ok: true, value: null });
  capture.cancelRecording.mockResolvedValue(undefined);
  capture.isRecording.mockReturnValue(true);
  backend.ensureAccessToken.mockResolvedValue("test-token");
  batch.transcribe.mockResolvedValue({
    ok: true,
    value: { transcript: "hola mundo", detectedLang: "es", provider: "mock" },
  });
});

afterEach(() => {
  dictationActions.teardown();
});

describe("startDictation", () => {
  it("surfaces a microphone permission error and never starts capture", async () => {
    capture.requestPermission.mockResolvedValueOnce({
      ok: false,
      error: EkweError.PERMISSION_MIC,
    });

    await dictationActions.startDictation("en", 60_000);

    expect(dictation$.status.peek()).toBe("error");
    expect(dictation$.error.peek()).toBe(
      ErrorMessages[EkweError.PERMISSION_MIC],
    );
    expect(capture.startRecording).not.toHaveBeenCalled();
  });

  it("is a no-op while a session is already active", async () => {
    dictation$.set({ ...INITIAL_STATE, status: "recording" });

    await dictationActions.startDictation("en", 60_000);

    expect(capture.requestPermission).not.toHaveBeenCalled();
    expect(dictation$.status.peek()).toBe("recording");
  });

  it("transitions to recording and seeds the audio store", async () => {
    await dictationActions.startDictation("es", 60_000);

    expect(dictation$.status.peek()).toBe("recording");
    expect(audio.setSessionId).toHaveBeenCalledTimes(1);
    expect(audio.setSourceLang).toHaveBeenCalledWith("es");
    expect(audio.setRecordingState).toHaveBeenCalledWith("recording");
    expect(capture.startRecording).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      "file",
    );
    expect(analytics.track).toHaveBeenCalledWith("dictation_started", {
      sourceLang: "es",
      maxDurationMs: 60_000,
      isLive: false,
    });
  });

  it("maps a native capture failure onto an error state", async () => {
    capture.startRecording.mockResolvedValueOnce({
      ok: false,
      error: EkweError.AUDIO_RECORD_FAIL,
    });

    await dictationActions.startDictation("en", 60_000);

    expect(dictation$.status.peek()).toBe("error");
    expect(dictation$.error.peek()).toBe(
      ErrorMessages[EkweError.AUDIO_RECORD_FAIL],
    );
  });

  it("connects the streaming channel in live mode", async () => {
    await dictationActions.startDictation("fr", 60_000, true);

    expect(dictation$.isLive.peek()).toBe(true);
    expect(stream.connect).toHaveBeenCalledWith({
      token: "test-token",
      lang: "fr",
      serverUrl: "wss://worker/kw",
      getToken: auth.getToken,
    });
    expect(capture.addPcmChunkListener).toHaveBeenCalledTimes(1);
  });

  it("blocks live mode when the monthly stream quota is exhausted", async () => {
    usage.snapshot = {
      day: "2026-10-22",
      resetsAt: Date.now() + 60_000,
      month: "2026-10",
      monthResetsAt: Date.now() + 9 * 24 * 60 * 60_000,
      meters: [
        {
          id: "stream",
          label: "Live dictation",
          unit: "min",
          used: 60,
          total: 60,
          remaining: 0,
        },
      ],
    };

    await dictationActions.startDictation("fr", 60_000, true);

    expect(stream.connect).not.toHaveBeenCalled();
    expect(dictation$.status.peek()).toBe("error");
    expect(dictation$.error.peek()).toBe(
      ErrorMessages[EkweError.QUOTA_EXCEEDED],
    );
    expect(capture.cancelRecording).toHaveBeenCalled();
  });
});

describe("stopDictation", () => {
  it("returns null when no session is recording", async () => {
    dictation$.set({
      ...INITIAL_STATE,
      status: "preview",
      capturedUri: "file:///old.m4a",
    });

    const result = await dictationActions.stopDictation();

    expect(result).toBeNull();
    expect(capture.stopRecording).not.toHaveBeenCalled();
  });

  it("resets to idle when native capture is already gone", async () => {
    dictation$.set({ ...INITIAL_STATE, status: "recording" });
    capture.isRecording.mockReturnValue(false);

    const result = await dictationActions.stopDictation();

    expect(result).toBeNull();
    expect(dictation$.status.peek()).toBe("idle");
    expect(audio.resetAudioState).toHaveBeenCalled();
  });

  it("lands on preview with the captured file metadata", async () => {
    dictation$.set({ ...INITIAL_STATE, status: "recording" });
    capture.stopRecording.mockResolvedValue({
      ok: true,
      value: {
        uri: "file:///rec.m4a",
        durationMs: 5000,
        meteringData: [0.4],
        waveform: [0.1, 0.2, 0.3],
      },
    });

    const result = await dictationActions.stopDictation();

    expect(result).toBe("file:///rec.m4a");
    expect(dictation$.status.peek()).toBe("preview");
    expect(dictation$.capturedUri.peek()).toBe("file:///rec.m4a");
    expect(dictation$.capturedDurationMs.peek()).toBe(5000);
    expect(dictation$.nativeWaveform.peek()).toEqual([0.1, 0.2, 0.3]);
    expect(audio.setDuration).toHaveBeenCalledWith(5);
    expect(audio.setRecordingState).toHaveBeenCalledWith("processing");
  });

  it("rejects clips shorter than 250ms as mised-taps", async () => {
    dictation$.set({ ...INITIAL_STATE, status: "recording" });
    capture.stopRecording.mockResolvedValue({
      ok: true,
      value: {
        uri: "file:///short.m4a",
        durationMs: 100,
        meteringData: [],
        waveform: [],
      },
    });

    const result = await dictationActions.stopDictation();

    expect(result).toBeNull();
    expect(dictation$.status.peek()).toBe("error");
    expect(dictation$.error.peek()).toBe(ErrorMessages[EkweError.TOO_SHORT]);
    expect(fileMock.deletes).toHaveBeenCalledTimes(1);
  });

  it("ignores a second stop while the first is in flight", async () => {
    dictation$.set({ ...INITIAL_STATE, status: "recording" });
    let resolveStop!: (value: unknown) => void;
    capture.stopRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStop = resolve;
        }),
    );

    const first = dictationActions.stopDictation();
    const second = dictationActions.stopDictation();

    expect(capture.stopRecording).toHaveBeenCalledTimes(1);

    resolveStop({
      ok: true,
      value: {
        uri: "file:///rec.m4a",
        durationMs: 5000,
        meteringData: [],
        waveform: [],
      },
    });

    expect(await first).toBe("file:///rec.m4a");
    expect(await second).toBeNull();
  });
});

describe("cancelDictation", () => {
  it("resets the machine and tears down the session", async () => {
    dictation$.set({ ...INITIAL_STATE, status: "recording" });

    await dictationActions.cancelDictation();

    expect(dictation$.status.peek()).toBe("idle");
    expect(capture.cancelRecording).toHaveBeenCalled();
    expect(stream.disconnect).toHaveBeenCalled();
    expect(audio.resetAudioState).toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledWith("dictation_cancelled", {
      status: "recording",
      durationMs: 0,
    });
  });
});

describe("confirmDictation", () => {
  it("is ignored without a valid preview", async () => {
    const result = await dictationActions.confirmDictation("en");

    expect(result).toBeNull();
    expect(batch.transcribe).not.toHaveBeenCalled();
  });

  it("transcribes the captured file, invalidates usage, and cleans up", async () => {
    dictation$.set({
      ...INITIAL_STATE,
      status: "preview",
      capturedUri: "file:///rec.m4a",
      capturedDurationMs: 5000,
      meteringData: [0.4],
      nativeWaveform: [],
    });

    const result = await dictationActions.confirmDictation("en");

    expect(result).toBe("hola mundo");
    expect(batch.transcribe).toHaveBeenCalledWith(
      {
        uri: "file:///rec.m4a",
        durationMs: 5000,
        meteringData: [0.4],
        waveform: [],
      },
      "en",
      expect.any(AbortSignal),
    );
    expect(audio.appendTranscript).toHaveBeenCalledWith("hola mundo");
    expect(audio.setRecordingState).toHaveBeenCalledWith("done");
    expect(usage.invalidate).toHaveBeenCalled();
    expect(dictation$.status.peek()).toBe("idle");
    expect(fileMock.deletes).toHaveBeenCalledTimes(1);
  });

  it("keeps the clip on failure so it can be retried without re-recording", async () => {
    dictation$.set({
      ...INITIAL_STATE,
      status: "preview",
      capturedUri: "file:///rec.m4a",
      capturedDurationMs: 5000,
    });
    batch.transcribe.mockResolvedValueOnce({
      ok: false,
      error: EkweError.TRANSCRIPTION_FAIL,
    });

    const result = await dictationActions.confirmDictation("en");

    expect(result).toBeNull();
    // Back to `preview`, not `error`: the recording survives so the user can
    // simply press confirm again. Deleting it here meant a timeout could only
    // be recovered from by re-recording.
    expect(dictation$.status.peek()).toBe("preview");
    expect(dictation$.capturedUri.peek()).toBe("file:///rec.m4a");
    expect(dictation$.error.peek()).toBe(
      ErrorMessages[EkweError.TRANSCRIPTION_FAIL],
    );
    expect(fileMock.deletes).not.toHaveBeenCalled();
    expect(audio.setError).toHaveBeenCalledWith(EkweError.TRANSCRIPTION_FAIL);
    expect(analytics.track).toHaveBeenCalledWith("transcription_failed", {
      sourceLang: "en",
      durationMs: 5000,
      error: EkweError.TRANSCRIPTION_FAIL,
    });
  });

  it("retries the same clip and succeeds", async () => {
    dictation$.set({
      ...INITIAL_STATE,
      status: "preview",
      capturedUri: "file:///rec.m4a",
      capturedDurationMs: 5000,
    });
    batch.transcribe
      .mockResolvedValueOnce({ ok: false, error: EkweError.TRANSCRIBE_TIMEOUT })
      .mockResolvedValueOnce({
        ok: true,
        value: { transcript: "retry worked", detectedLang: "en" },
      });

    expect(await dictationActions.confirmDictation("en")).toBeNull();
    expect(dictation$.capturedUri.peek()).toBe("file:///rec.m4a");

    expect(await dictationActions.confirmDictation("en")).toBe("retry worked");
    expect(fileMock.deletes).toHaveBeenCalledTimes(1);
  });

  it("uses the accumulated transcript directly in live mode", async () => {
    dictation$.set({
      ...INITIAL_STATE,
      status: "preview",
      capturedUri: "file:///rec.m4a",
      isLive: true,
      finalText: "hello world",
    });

    const result = await dictationActions.confirmDictation("fr");

    expect(result).toBe("hello world");
    expect(batch.transcribe).not.toHaveBeenCalled();
    expect(audio.appendTranscript).toHaveBeenCalledWith("hello world");
    expect(audio.setRecordingState).toHaveBeenCalledWith("done");
    expect(dictation$.status.peek()).toBe("idle");
  });
});

describe("commitRecording", () => {
  it("is ignored without a valid preview", () => {
    const result = dictationActions.commitRecording();

    expect(result).toBeNull();
    expect(batch.transcribe).not.toHaveBeenCalled();
  });

  it("returns the recording and KEEPS the file (no ASR)", () => {
    dictation$.set({
      ...INITIAL_STATE,
      status: "preview",
      capturedUri: "file:///rec.m4a",
      capturedDurationMs: 5000,
      nativeWaveform: [0.1, 0.2, 0.3],
    });

    const result = dictationActions.commitRecording();

    expect(result).toEqual({
      uri: "file:///rec.m4a",
      durationMs: 5000,
      waveform: [0.1, 0.2, 0.3],
    });
    expect(batch.transcribe).not.toHaveBeenCalled();
    expect(audio.setDuration).toHaveBeenCalledWith(5);
    expect(audio.setRecordingState).toHaveBeenCalledWith("done");
    expect(dictation$.status.peek()).toBe("idle");
    expect(dictation$.capturedUri.peek()).toBeNull();

    expect(fileMock.deletes).not.toHaveBeenCalled();
  });
});
