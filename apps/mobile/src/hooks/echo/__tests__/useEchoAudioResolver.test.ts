// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEchoAudioResolver } from "@/hooks/echo/useEchoAudioResolver";

const CACHE_DIR = "file:///mock/cache/directory/";

const impl = vi.hoisted(() => ({
  resolveAndTranscodeToOpus: vi.fn(),
  resolveToFileUri: vi.fn(),
  probeAudioDurationMs: vi.fn(),
  dismissNativeLoader: vi.fn(),
  cleanEchoCache: vi.fn(),
  processSharedFile: vi.fn(),
  transcodeToOpus: vi.fn(),
}));

// Literal, not CACHE_DIR: the factory is hoisted above every top-level const.
vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///mock/cache/directory/" } },
}));

vi.mock("@/services/intentService", () => ({
  IntentService: {
    resolveAndTranscodeToOpus: impl.resolveAndTranscodeToOpus,
    resolveToFileUri: impl.resolveToFileUri,
    probeAudioDurationMs: impl.probeAudioDurationMs,
    dismissNativeLoader: impl.dismissNativeLoader,
  },
}));

vi.mock("@/utils/audioCache", () => ({
  cleanEchoCache: impl.cleanEchoCache,
}));

vi.mock("@/services/audioCapture", () => ({
  AudioCapture: { processSharedFile: impl.processSharedFile },
}));

vi.mock("@/services/audioTranscoder", () => ({
  AudioTranscoder: { transcodeToOpus: impl.transcodeToOpus },
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The native side derives the playback copy as a sibling of the Opus artifact,
// so the resolver must predict that same path to be able to clean it up.
const anyOgg = /ekwe_converted_.*\.ogg$/;
const anyM4a = /ekwe_converted_.*\.m4a$/;

const cleanedPaths = (): string[] =>
  impl.cleanEchoCache.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  impl.dismissNativeLoader.mockResolvedValue(undefined);
  impl.resolveToFileUri.mockResolvedValue("file:///shared/audio.m4a");
  impl.probeAudioDurationMs.mockResolvedValue(1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEchoAudioResolver playback copy", () => {
  it("surfaces the native playbackUri so the player never opens the Ogg", async () => {
    const playbackUri = `${CACHE_DIR}ekwe_converted_7_abc.m4a`;
    impl.resolveAndTranscodeToOpus.mockResolvedValue({
      success: true,
      error: "",
      durationMs: 1000,
      waveform: [0.1, 0.5],
      playbackUri,
    });

    const { result } = renderHook(() =>
      useEchoAudioResolver({ audioUri: "file:///shared/audio.m4a" }),
    );

    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.audioUri).toMatch(anyOgg);
    expect(result.current.playbackUri).toBe(playbackUri);
  });

  it("leaves playbackUri undefined when native reports no copy", async () => {
    // A decode with no PCM, or an encoder that produced nothing, comes back as
    // an empty string. The player must fall back to the Opus path rather than
    // try to open "".
    impl.resolveAndTranscodeToOpus.mockResolvedValue({
      success: true,
      error: "",
      durationMs: 1000,
      waveform: [],
      playbackUri: "",
    });

    const { result } = renderHook(() =>
      useEchoAudioResolver({ audioUri: "file:///shared/audio.m4a" }),
    );

    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.playbackUri).toBeUndefined();
  });

  it("cleans the predicted M4A sibling when native rejects the file", async () => {
    impl.resolveAndTranscodeToOpus.mockResolvedValue({
      success: false,
      error: "FILE_TOO_LARGE",
      durationMs: 0,
      waveform: [],
    });

    const { result } = renderHook(() =>
      useEchoAudioResolver({ audioUri: "file:///shared/audio.m4a" }),
    );

    await waitFor(() => expect(result.current.resolveError).toBeTruthy());
    // Both halves are reclaimed: a half-written artifact would otherwise
    // outlive the rejection and be mistaken for a cached playback copy.
    expect(cleanedPaths().some((p) => anyOgg.test(p))).toBe(true);
    expect(cleanedPaths().some((p) => anyM4a.test(p))).toBe(true);
  });

  it("cleans the previous playback copy when a new intent resolves", async () => {
    const first = `${CACHE_DIR}ekwe_converted_1_first.m4a`;
    impl.resolveAndTranscodeToOpus.mockResolvedValueOnce({
      success: true,
      error: "",
      durationMs: 1000,
      waveform: [],
      playbackUri: first,
    });

    const { result, rerender } = renderHook(
      ({ uri }: { uri: string }) => useEchoAudioResolver({ audioUri: uri }),
      { initialProps: { uri: "file:///shared/first.m4a" } },
    );

    await waitFor(() => expect(result.current.playbackUri).toBe(first));
    impl.cleanEchoCache.mockClear();

    const second = `${CACHE_DIR}ekwe_converted_2_second.m4a`;
    impl.resolveAndTranscodeToOpus.mockResolvedValueOnce({
      success: true,
      error: "",
      durationMs: 1000,
      waveform: [],
      playbackUri: second,
    });
    rerender({ uri: "file:///shared/second.m4a" });

    await waitFor(() => expect(result.current.playbackUri).toBe(second));
    expect(impl.cleanEchoCache).toHaveBeenCalledWith(first);
  });
});
