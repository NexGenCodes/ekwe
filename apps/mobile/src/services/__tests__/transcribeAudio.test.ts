import { beforeEach, describe, expect, it, vi } from "vitest";

import { WITAI_SAFE_DURATION_MS } from "@ekwe/shared/plans";

import { EkweError } from "@/constants/errors";
import type { ProcessedAudio } from "@/services/audioProcessor";
import { transcribeAudio } from "@/services/transcribeAudio";
import { auth$ } from "@/store/auth";

const uploadMultipartMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getWorkerUrlMock = vi.hoisted(() => vi.fn());
const isDefinitelyOfflineMock = vi.hoisted(() => vi.fn());

const fsMock = vi.hoisted(() => ({
  exists: true,
  size: 4096,
  deleted: [] as string[],
}));

const okResult = vi.hoisted(() => ({
  success: true,
  error: "",
  durationMs: 60_000,
  waveform: [],
  vorbisSuccess: true,
}));

const nativeMock = vi.hoisted(() => ({
  resolveAudio: vi.fn(),
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
    delete(): void {
      fsMock.deleted.push(this.uri);
    }
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
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

const resolveCall = (): {
  input: string;
  vorbisPath: string | null;
} => {
  const [input, options] = nativeMock.resolveAudio.mock.calls[0];
  return { input, vorbisPath: options.vorbisOutputPath ?? null };
};

describe("transcribeAudio upload artifact", () => {
  beforeEach(() => {
    auth$.isPro.set(false);
    nativeMock.resolveAudio.mockReset().mockResolvedValue(okResult);
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
    fsMock.deleted.length = 0;
  });

  it("converts any input to Vorbis and uploads the copy", async () => {
    const result = await transcribeAudio(
      audio("file:///cache/recording.m4a", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);

    const { input, vorbisPath } = resolveCall();
    expect(input).toBe("/cache/recording.m4a");
    expect(vorbisPath).toMatch(/^file:\/\/\/cache\/ekwe_vorbis_[^.]*\.ogg$/);

    expect(uploadedUri()).toBe(vorbisPath);
    expect(uploadMultipartMock.mock.calls[0][2].mimeType).toBe("audio/ogg");
  });

  it("deletes the converted copy once the upload settles", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "en");

    const { vorbisPath } = resolveCall();
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

    const { vorbisPath } = resolveCall();
    expect(nativeMock.deleteFile).toHaveBeenCalledWith(vorbisPath);
  });

  it("skips Vorbis when the language is auto (Opus only)", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "auto");

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
    expect(resolveCall().vorbisPath).toBeNull();
    expect(uploadedUri()).toMatch(/^file:\/\/\/cache\/ekwe_opus_/);
  });

  it("skips Vorbis when the language is empty (Opus only)", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "");

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
    expect(resolveCall().vorbisPath).toBeNull();
    expect(uploadedUri()).toMatch(/^file:\/\/\/cache\/ekwe_opus_/);
  });

  it("rejects audio over the free plan's duration limit before uploading", async () => {
    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 120_001),
      "en",
    );

    expect(result).toEqual({ ok: false, error: EkweError.AUDIO_TOO_LONG });
    expect(nativeMock.resolveAudio).not.toHaveBeenCalled();
  });

  it("skips Vorbis when duration is past the cap (Opus only)", async () => {
    auth$.isPro.set(true);
    await transcribeAudio(
      audio("file:///cache/recording.ogg", WITAI_SAFE_DURATION_MS + 1),
      "en",
    );

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
    expect(nativeMock.probeAudioDurationMs).not.toHaveBeenCalled();
    expect(resolveCall().vorbisPath).toBeNull();
  });

  it("converts at exactly the cap", async () => {
    auth$.isPro.set(true);
    await transcribeAudio(
      audio("file:///cache/recording.ogg", WITAI_SAFE_DURATION_MS),
      "en",
    );

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
  });

  it("probes duration when the caller does not know it", async () => {
    await transcribeAudio(audio("file:///cache/recording.ogg", 0), "en");

    expect(nativeMock.probeAudioDurationMs).toHaveBeenCalledWith(
      "/cache/recording.ogg",
    );
    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
  });

  it("skips Vorbis when the probe finds the clip is too long", async () => {
    nativeMock.probeAudioDurationMs.mockResolvedValue(
      WITAI_SAFE_DURATION_MS + 1,
    );

    await transcribeAudio(audio("file:///cache/recording.ogg", 0), "en");

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
    expect(resolveCall().vorbisPath).toBeNull();
  });

  it("skips Vorbis when the probe cannot read a duration", async () => {
    nativeMock.probeAudioDurationMs.mockResolvedValue(-1);

    await transcribeAudio(audio("file:///cache/recording.ogg", 0), "en");

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
    expect(resolveCall().vorbisPath).toBeNull();
  });

  it("uploads as-is when the Vorbis encode fails", async () => {
    nativeMock.resolveAudio.mockResolvedValue({
      ...okResult,
      vorbisSuccess: false,
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
    nativeMock.resolveAudio.mockResolvedValue({
      ...okResult,
      success: false,
      error: "encode failed",
    });

    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
  });

  it("uploads as-is when the transcode throws", async () => {
    nativeMock.resolveAudio.mockRejectedValue(new Error("bridge missing"));

    const result = await transcribeAudio(
      audio("file:///cache/recording.ogg", 60_000),
      "en",
    );

    expect(result.ok).toBe(true);
    expect(uploadedUri()).toBe("file:///cache/recording.ogg");
    expect(nativeMock.deleteFile).not.toHaveBeenCalled();
  });

  it("cleans up partial transcoded temps when the encoder fails", async () => {
    nativeMock.resolveAudio.mockResolvedValue({
      ...okResult,
      success: false,
      error: "encode failed",
    });

    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "en");

    expect(fsMock.deleted.some((p) => p.includes("ekwe_opus_"))).toBe(true);
    expect(fsMock.deleted.some((p) => p.includes("ekwe_vorbis_"))).toBe(true);
  });

  it("cleans up partial transcoded temps when the transcode throws", async () => {
    nativeMock.resolveAudio.mockRejectedValue(new Error("bridge missing"));

    await transcribeAudio(audio("file:///cache/recording.ogg", 60_000), "en");

    expect(fsMock.deleted.some((p) => p.includes("ekwe_opus_"))).toBe(true);
    expect(fsMock.deleted.some((p) => p.includes("ekwe_vorbis_"))).toBe(true);
  });

  it("reuses an existing Opus file without re-transcoding when Vorbis is not needed", async () => {
    const result = await transcribeAudio(
      audio("file:///cache/ekwe_opus_abc.ogg", 60_000),
      "auto",
    );

    expect(result.ok).toBe(true);
    expect(nativeMock.resolveAudio).not.toHaveBeenCalled();
    expect(uploadedUri()).toBe("file:///cache/ekwe_opus_abc.ogg");
    expect(nativeMock.deleteFile).not.toHaveBeenCalled();
  });

  it("still transcodes an existing Opus file to Vorbis when a language is set", async () => {
    await transcribeAudio(
      audio("file:///cache/ekwe_opus_abc.ogg", 60_000),
      "en",
    );

    expect(nativeMock.resolveAudio).toHaveBeenCalledTimes(1);
    expect(resolveCall().input).toBe("/cache/ekwe_opus_abc.ogg");
    expect(resolveCall().vorbisPath).toMatch(/ekwe_vorbis_/);
  });
});
