// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Drives the *real* `useSharedAudioPlayer` against a fake `expo-audio` that
 * mirrors the upstream contract: the source is installed asynchronously after
 * `preloadAsync` settles, and `replace()` drops `isLoaded` to false before the
 * replacement reports ready. Unit tests that stub the player cannot see this
 * window, and it is what lets a swapped clip autoplay the previous one.
 */

interface FakeStatus {
  isLoaded: boolean;
  isBuffering: boolean;
  playing: boolean;
  didJustFinish: boolean;
  duration: number;
  currentTime: number;
  playbackRate: number;
}

const createStatus = (): FakeStatus => ({
  isLoaded: false,
  isBuffering: false,
  playing: false,
  didJustFinish: false,
  duration: 1,
  currentTime: 0,
  playbackRate: 1,
});

let playerStatus: FakeStatus = createStatus();
let replaceReportsUnloaded = true;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getStatus = (): FakeStatus => playerStatus;

const setStatus = (next: Partial<FakeStatus>): void => {
  playerStatus = { ...playerStatus, ...next };
  listeners.forEach((listener) => listener());
};

const replaceCalls: (string | null)[] = [];
const playCalls: string[] = [];
/** Seeks requested but not yet applied. Drains itself on the next microtask. */
let pendingSeeks: (() => void)[] = [];
const drainSeeks = (): void => {
  const seeks = pendingSeeks;
  pendingSeeks = [];
  seeks.forEach((run) => run());
};
/** Work queued by the fake's async source install, released by `flushPreloads`. */
let pendingInstalls: (() => void)[] = [];
/** The media element reporting ready, which lands a tick after `replace()`. */
let pendingLoads: (() => void)[] = [];

/**
 * Drains the install and the subsequent load in two separate ticks, because
 * `replace()` and the new media's `onloadeddata` do not land together.
 */
const flushPreloads = async (): Promise<void> => {
  const installs = pendingInstalls;
  pendingInstalls = [];
  pendingLoads = [];
  await act(async () => {
    installs.forEach((run) => run());
  });
  const loads = pendingLoads;
  pendingLoads = [];
  await act(async () => {
    loads.forEach((run) => run());
  });
};

const fakePlayer = {
  id: "fake-player",
  get currentStatus() {
    return playerStatus;
  },
  play: () => {
    playCalls.push(playerStatus.currentTime === 0 ? "from-start" : "mid");
    setStatus({ playing: true });
  },
  pause: () => setStatus({ playing: false }),
  remove: () => {},
  /**
   * Upstream returns a promise and applies the seek asynchronously, so `play()`
   * called without awaiting this lands at the pre-seek position.
   */
  seekTo: (to: number) => {
    pendingSeeks.push(() => setStatus({ currentTime: to }));
    // Settles on the next microtask, like the real async seek.
    return Promise.resolve().then(() => {
      drainSeeks();
    });
  },
  setPlaybackRate: () => {},
  setAudioSamplingEnabled: () => {},
  // Mirrors expo-audio, where these read through to the underlying player
  // rather than being snapshots taken at mount.
  get currentTime() {
    return playerStatus.currentTime;
  },
  get duration() {
    return playerStatus.duration;
  },
};

vi.mock("expo-audio", async () => {
  const react = await import("react");

  return {
    useAudioPlayer: (source: string | null) => {
      // Mirrors upstream: `preloadAsync(...).finally(() => player.replace(...))`,
      // so the install is deferred and `isLoaded` is stale until it settles.
      react.useEffect(() => {
        if (!source) return;
        pendingInstalls.push(() => {
          replaceCalls.push(source);
          if (replaceReportsUnloaded) setStatus({ isLoaded: false });
          pendingLoads.push(() => setStatus({ isLoaded: true }));
        });
      }, [source]);
      return fakePlayer;
    },
    useAudioPlayerStatus: () =>
      react.useSyncExternalStore(subscribe, getStatus, getStatus),
    setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
    setIsAudioActiveAsync: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/utils/haptics", () => ({ triggerHaptic: vi.fn() }));
vi.mock("@/utils/platform", () => ({ isIOS: false, isAndroid: false }));
vi.mock("@/utils/audioCache", () => ({
  cleanEchoCache: vi.fn(),
  cleanAudioArtifacts: vi.fn(),
}));
vi.mock("@/hooks/audio/audioFocus", () => ({
  createAudioFocus: () => ({ claim: vi.fn(), release: vi.fn() }),
}));
vi.mock("@/services/audioTranscoder", () => ({
  AudioTranscoder: {
    // Ogg sources derive an M4A playback copy on every platform now. Model the
    // real stable-hash naming (distinct per input file, stable for it), so a
    // source swap produces a genuinely different playable path.
    createPlaybackCopyForPlayback: vi.fn((inputUri: string) =>
      Promise.resolve({
        ok: true,
        value: inputUri.replace(/\.ogg$/, ".m4a"),
      }),
    ),
    decodeToWav: vi.fn(),
  },
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
vi.mock("react-native-reanimated", async () => {
  const react = await import("react");

  return {
    // Stable per call site, like the real hook. A fresh object each render
    // would re-run every effect listing a shared value in its deps, resetting
    // the playback state these tests assert on.
    useSharedValue: (initial: number) => {
      const ref = react.useRef({ value: initial });
      ref.current.value = initial;
      return ref.current;
    },
    useFrameCallback: () => ({ setActive: vi.fn() }),
  };
});

import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { setAudioModeAsync } from "expo-audio";

/** Lets the source-install effect enqueue its work. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  playerStatus = createStatus();
  replaceReportsUnloaded = true;
  listeners.clear();
  replaceCalls.length = 0;
  playCalls.length = 0;
  pendingInstalls = [];
  pendingLoads = [];
  pendingSeeks = [];
  vi.mocked(setAudioModeAsync).mockReset();
  vi.mocked(setAudioModeAsync).mockResolvedValue(undefined);
});

describe("useSharedAudioPlayer readiness", () => {
  it("is not ready before anything has loaded", () => {
    const { result } = renderHook(() => useSharedAudioPlayer(null));
    expect(result.current.isReady).toBe(false);
  });

  it("becomes ready once the first clip loads", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    expect(result.current.isReady).toBe(false);

    await flushPreloads();

    expect(result.current.isLoaded).toBe(true);
    expect(result.current.isReady).toBe(true);
  });

  it("is not ready while a swapped clip is still preloading", async () => {
    const { result, rerender } = renderHook(
      ({ uri }: { uri: string | null }) => useSharedAudioPlayer(uri),
      { initialProps: { uri: "file:///a.ogg" as string | null } },
    );
    await settle();
    await flushPreloads();
    expect(result.current.isReady).toBe(true);

    // Swap the source. Upstream keeps `isLoaded` true until the async
    // `replace()` runs, so this is the stale window a naive gate falls into.
    await act(async () => {
      rerender({ uri: "file:///b.ogg" });
      await Promise.resolve();
    });

    expect(result.current.isReady).toBe(false);

    await flushPreloads();
    expect(result.current.isReady).toBe(true);
    // The player receives the derived M4A copy, never the raw Ogg.
    expect(replaceCalls).toContain("file:///b.m4a");
  });

  it("does not autoplay a swapped clip on the previous clip's readiness", async () => {
    const { result, rerender } = renderHook(
      ({ uri }: { uri: string | null }) => useSharedAudioPlayer(uri),
      { initialProps: { uri: "file:///a.ogg" as string | null } },
    );
    await settle();
    await flushPreloads();
    playCalls.length = 0;

    await act(async () => {
      rerender({ uri: "file:///b.ogg" });
      await Promise.resolve();
    });

    // A caller gating on `isLoaded` alone would see true here and start the
    // wrong clip; readiness is the value that must be consulted.
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it("restarts a finished clip from the beginning", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    await flushPreloads();
    playCalls.length = 0;

    // The clip played to its end.
    await act(async () => {
      setStatus({ currentTime: 12, didJustFinish: true, playing: false });
      await Promise.resolve();
    });
    expect(result.current.isEnded).toBe(true);

    await act(async () => {
      await result.current.play();
    });

    // `play` must await the seek before starting, or the second tap resumes
    // from the end and stops again immediately.
    expect(playCalls).toEqual(["from-start"]);
  });

  it("restarts from the beginning when replayed from the end mid-clip", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    await flushPreloads();
    playCalls.length = 0;

    // Not flagged as finished, but parked on the last frame.
    await act(async () => {
      setStatus({ currentTime: 11.999, duration: 12, playing: false });
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.play();
    });

    expect(playCalls).toEqual(["from-start"]);
  });

  it("plays from the current position when not at the end", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    await flushPreloads();
    playCalls.length = 0;

    await act(async () => {
      setStatus({ currentTime: 4, duration: 12, playing: false });
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.play();
    });

    expect(playCalls).toEqual(["mid"]);
  });

  it("seeks to zero before playing on playFromStart", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    await flushPreloads();
    playCalls.length = 0;

    await act(async () => {
      setStatus({ currentTime: 9, duration: 12, playing: false });
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.playFromStart();
    });

    expect(playCalls).toEqual(["from-start"]);
  });

  it("falls back to reported readiness when no false transition arrives", async () => {
    vi.useFakeTimers();
    try {
      replaceReportsUnloaded = false;
      const { result, rerender } = renderHook(
        ({ uri }: { uri: string | null }) => useSharedAudioPlayer(uri),
        { initialProps: { uri: "file:///a.ogg" as string | null } },
      );
      await settle();
      await flushPreloads();
      expect(result.current.isReady).toBe(true);

      await act(async () => {
        rerender({ uri: "file:///c.ogg" });
        await Promise.resolve();
      });
      // No isLoaded:false was ever reported, so only the grace period can
      // rescue this from stalling forever.
      expect(result.current.isReady).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });
      expect(result.current.isReady).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops playing when its uri is revoked", async () => {
    // Dictation commit/cancel resets the store while the preview is still
    // audible; without a pause the orphaned clip plays out on its own.
    const { result, rerender } = renderHook(
      ({ uri }: { uri: string | null }) => useSharedAudioPlayer(uri),
      { initialProps: { uri: "file:///a.ogg" as string | null } },
    );
    await settle();
    await flushPreloads();

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.isPlaying).toBe(true);

    await act(async () => {
      rerender({ uri: null });
      await Promise.resolve();
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it("does not start a clip that was stopped while the session was claimed", async () => {
    const { result } = renderHook(() => useSharedAudioPlayer("file:///a.ogg"));
    await settle();
    await flushPreloads();
    playCalls.length = 0;

    // The audio session claim stalls, so the start is still in flight.
    let releaseSession: (() => void) | null = null;
    vi.mocked(setAudioModeAsync).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSession = resolve;
        }),
    );

    let start: Promise<void> = Promise.resolve();
    await act(async () => {
      start = result.current.playFromStart();
      await Promise.resolve();
    });
    expect(playCalls).toEqual([]);

    // The clip is stopped before the session is granted.
    await act(async () => {
      result.current.pause();
      await Promise.resolve();
    });

    await act(async () => {
      releaseSession?.();
      await start;
    });

    // The stop wins: the clip must not come back to life.
    expect(playCalls).toEqual([]);
  });
});
