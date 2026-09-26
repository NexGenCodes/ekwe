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
    playCalls.push(playerStatus.isLoaded ? "ready" : "not-ready");
    setStatus({ playing: true });
  },
  pause: () => setStatus({ playing: false }),
  remove: () => {},
  seekTo: () => {},
  setPlaybackRate: () => {},
  setAudioSamplingEnabled: () => {},
  currentTime: 0,
  duration: 1,
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
  AudioTranscoder: { remuxToCaf: vi.fn(), decodeToWav: vi.fn() },
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
    expect(replaceCalls).toContain("file:///b.ogg");
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
});
