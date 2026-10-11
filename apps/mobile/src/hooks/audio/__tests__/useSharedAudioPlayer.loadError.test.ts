// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * iOS cannot play Ogg/Opus natively, so `useSharedAudioPlayer` derives a
 * playable copy and falls back to a WAV decode. When both derivations fail the
 * clip is unplayable, and the hook must surface that instead of spinning
 * forever on `isReady === false`.
 */

const createPlaybackCopyForPlayback = vi.hoisted(() => vi.fn());
const decodeToWav = vi.hoisted(() => vi.fn());

vi.mock("expo-audio", () => ({
  useAudioPlayer: () => ({
    play: vi.fn(),
    pause: vi.fn(),
    remove: vi.fn(),
    seekTo: vi.fn(() => Promise.resolve()),
    setPlaybackRate: vi.fn(),
    currentTime: 0,
    duration: 1,
  }),
  useAudioPlayerStatus: () => ({
    isLoaded: false,
    isBuffering: false,
    playing: false,
    didJustFinish: false,
    duration: 1,
    currentTime: 0,
    playbackRate: 1,
  }),
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  setIsAudioActiveAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/haptics", () => ({ triggerHaptic: vi.fn() }));
vi.mock("@/utils/platform", () => ({ isIOS: true, isAndroid: false }));
vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/hooks/audio/audioFocus", () => ({
  createAudioFocus: () => ({ claim: vi.fn(), release: vi.fn() }),
}));
vi.mock("@/services/audioTranscoder", () => ({
  AudioTranscoder: { createPlaybackCopyForPlayback, decodeToWav },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get exists() {
      return false;
    }
  },
  Paths: { cache: { uri: "file:///mock/cache/" } },
}));
vi.mock("react-native-reanimated", () => ({
  useSharedValue: (initial: number) => ({ value: initial }),
  useFrameCallback: () => ({ setActive: vi.fn() }),
}));

import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";

/** Flushes the chained transcode promises (create → fallback → decode). */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useSharedAudioPlayer load errors", () => {
  beforeEach(() => {
    createPlaybackCopyForPlayback.mockReset();
    decodeToWav.mockReset();
    createPlaybackCopyForPlayback.mockResolvedValue({ ok: false, error: "no" });
    decodeToWav.mockResolvedValue({ ok: false, error: "nope" });
  });

  it("leaves loadError null for a playable non-Ogg source", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.m4a"));
    await settle();
    expect(result.current.loadError).toBeNull();
  });

  it("reports loadError when both derivations fail", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    expect(result.current.loadError).toBe(
      "This audio could not be decoded for playback.",
    );
  });

  it("clears loadError when a retry succeeds", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    expect(result.current.loadError).not.toBeNull();

    createPlaybackCopyForPlayback.mockResolvedValueOnce({
      ok: true,
      value: "file:///cache/derived.m4a",
    });

    act(() => {
      result.current.retryLoad();
    });
    await settle();

    expect(result.current.loadError).toBeNull();
  });

  it("does not run the transcoder for a playable non-Ogg source", async () => {
    renderHook(() => useSharedAudioPlayer("file:///a.m4a"));
    await settle();
    expect(createPlaybackCopyForPlayback).not.toHaveBeenCalled();
    expect(decodeToWav).not.toHaveBeenCalled();
  });
});
