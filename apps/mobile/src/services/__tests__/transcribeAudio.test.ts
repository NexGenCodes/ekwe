import { beforeEach, describe, expect, it, vi } from "vitest";

import { WIT_VORBIS_MAX_DURATION_MS } from "@ekwe/shared/plans";

import { EkweError } from "@/constants/errors";
import type { ProcessedAudio } from "@/services/audioProcessor";
import { transcribeAudio } from "@/services/transcribeAudio";

const uploadMultipartMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getWorkerUrlMock = vi.hoisted(() => vi.fn());
const isDefinitelyOfflineMock = vi.hoisted(() => vi.fn());

const fsMock = vi.hoisted(() => ({
  exists: true,
  size: 4096,
}));

const okResult = vi.hoisted(() => ({
  success: true,
  error: "",
  durationMs: 60_000,
  waveform: [],
}));

const nativeMock = vi.hoisted(() => ({
  transcodeToDualWithWaveform: vi.fn(),
  probeAudioDurationMs: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock("expo", () => ({
  requireNativeModule: () => nativeMock,
}));

vi.mock("expo-file-system", () => {
  class MockFile {
    exists = fsMock.exists;
    size = fsMock.size;
    constructor(public uri: string) {}
  }
  return {
    File: MockFile,
    Paths: { cache: { uri: "file:///cache/" } },
  };
});

vi.mock("@/services/audioProcessor", () => ({ AudioProcessor: {} }));

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

vi.mock("@/services/uploadMultipart", () => ({
  uploadMultipart: uploadMultipartMock,
  getMimeType: vi.fn((ext: string) =>
    ext === "ogg" ? "audio/ogg" : "audio/mp4",
  ),
}));

vi.mock("@/utils/connectivity", () => ({
  isDefinitelyOffline: isDefinitelyOfflineMock,
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/http", () => ({
  getWorkerUrl: getWorkerUrlMock,
  mapWorkerError: vi.fn((_code: string, fallback: string) => fallback),
  isTimeoutError: vi.fn(() => false),
}));

const WORKER_URL = "https://worker.test";

const okUpload = (): {
  status: number;
  body: string;
  headers: Record<string, string>;
} => ({
  status: 200,
  headers: {},
  body: JSON.stringify({ text: "hello", language: "en", provider: "witai" }),
});

const audio = (uri: string, durationMs: number): ProcessedAudio => ({
  uri,
  durationMs,
  averageDb: -20,
  meteringData: [],
  waveform: [],
});

const uploadedUri = (): string | null => {
  const [file] = uploadMultipartMock.mock.calls[0] ?? [];
  return file?.uri ?? null;
};

const dualCall = (): {
  input: string;
  opusPath: string;
  vorbisPath: string;
} => {
  const [input, opusPath, vorbisPath] =
    nativeMock.transcodeToDualWithWaveform.mock.calls[0];
  return { input, opusPath, vorbisPath };
};

describe("transcribeAudio upload artifact", () => {
  beforeEach(() => {
    nativeMock.transcodeToDualWithWaveform.mockReset().mockResolvedValue({
      opus: okResult,
      vorbis: okResult,
    });
    nativeMock.probeAudioDurationMs.mockReset().mockResolvedValue(60_000);
    uploadMultipartMock.mockReset().mockResolvedValue(okUpload());
    nativeMock.deleteFile.mockReset().mockResolvedValue(true);
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    getWorkerUrlMock.mockReturnValue(WORKER_URL);
    isDefinitelyOfflineMock.mockReturnValue(false);
    fsMock.exists = true;
    fsMock.size = 4096;
  });

  it("converts any input to Vorbis and uploads the copy", async () => {
    const result = await transcribeAudio(
      audio("file:///cache/recording.m4a", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(nativeMock.transcodeToDualWithWaveform).toHaveBeenCalledTimes(1);

    const { input, vorbisPath } = dualCall();
    expect(input).toBe("/cache/recording.m4a");
    expect(vorbisPath).toMatch(/^file:\/\/\/cache\/ekwe_vorbis_[^.]*\.ogg$/);

    expect(uploadedUri()).toBe(vorbisPath);
    expect(uploadMultipartMock.mock.calls[0][2].mimeType).toBe("audio/ogg");
  });

  it("deletes the converted copy once the upload settles", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "en");

    const { vorbisPath } = dualCall();
    expect(nativeMock.deleteFile).toHaveBeenCalledWith(vorbisPath);
  });

  it("deletes the converted copy even when the upload fails", async () => {
    uploadMultipartMock.mockResolvedValue({
      status: 500,
      body: JSON.stringify({ error: "EKWE_TRANSCRIPTION_FAIL" }),
    });

    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 60_000),
      "en",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(EkweError.TRANSCRIPTION_FAIL);

    const { vorbisPath } = dualCall();
    expect(nativeMock.deleteFile).toHaveBeenCalledWith(vorbisPath);
  });

  it("skips the encode when the language is auto", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "auto");

    expect(nativeMock.transcodeToDualWithWaveform).not.toHaveBeenCalled();
    expect(nativeMock.deleteFile).not.toHaveBeenCalled();
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("skips the encode when the language is empty", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "");

    expect(nativeMock.transcodeToDualWithWaveform).not.toHaveBeenCalled();
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("skips the encode when duration is past the cap", async () => {
    await transcribeAudio(
      audio("file:///cache/recording.ogg", WIT_VORBIS_MAX_DURATION_MS + 1),
      "en",
    );

    expect(nativeMock.transcodeToDualWithWaveform).not.toHaveBeenCalled();
    expect(nativeMock.probeAudioDurationMs).not.toHaveBeenCalled();
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("converts at exactly the cap", async () => {
    await transcribeAudio(
      audio("file:///cache/recording.ogg", WIT_VORBIS_MAX_DURATION_MS),
      "en",
    );

    expect(nativeMock.transcodeToDualWithWaveform).toHaveBeenCalledTimes(1);
  });

  it("probes duration when the caller does not know it", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 0), "en");

    expect(nativeMock.probeAudioDurationMs).toHaveBeenCalledWith(
      "/cache/recording.ogg",
    );
    expect(nativeMock.transcodeToDualWithWaveform).toHaveBeenCalledTimes(1);
  });

  it("uploads as-is when the probe finds the clip is too long", async () => {
    nativeMock.probeAudioDurationMs.mockResolvedValue(
      WIT_VORBIS_MAX_DURATION_MS + 1,
    );

    await transcribeAudio(audio("file:///cache/recording.ogg", 0), "en");

    expect(nativeMock.transcodeToDualWithWaveform).not.toHaveBeenCalled();
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("uploads as-is when the probe cannot read a duration", async () => {
    nativeMock.probeAudioDurationMs.mockResolvedValue(-1);

    await transcribeAudio(audio("file:///cache/recording.ogg", 0), "en");

    expect(nativeMock.transcodeToDualWithWaveform).not.toHaveBeenCalled();
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("uploads as-is when the Vorbis encode fails", async () => {
    nativeMock.transcodeToDualWithWaveform.mockResolvedValue({
      opus: okResult,
      vorbis: { ...okResult, success: false, error: "encode failed" },
    });

    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
    expect(nativeMock.deleteFile).not.toHaveBeenCalled();
  });

  it("uploads as-is when the Opus encode fails", async () => {
    nativeMock.transcodeToDualWithWaveform.mockResolvedValue({
      opus: { ...okResult, success: false, error: "encode failed" },
      vorbis: okResult,
    });

    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("uploads as-is when the transcode throws", async () => {
    nativeMock.transcodeToDualWithWaveform.mockRejectedValue(
      new Error("bridge missing"),
    );

    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
    expect(nativeMock.deleteFile).not.toHaveBeenCalled();
  });
});
