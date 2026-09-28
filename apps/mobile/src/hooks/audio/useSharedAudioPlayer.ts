import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";
import { triggerHaptic } from "@/utils/haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSharedValue,
  SharedValue,
  useFrameCallback,
} from "react-native-reanimated";

import { AudioTranscoder } from "@/services/audioTranscoder";
import { isIOS } from "@/utils/platform";
import logger from "@/utils/logger";
import { createAudioFocus } from "@/hooks/audio/audioFocus";

export interface SharedAudioPlayer {
  play: () => Promise<void>;
  playFromStart: () => Promise<void>;
  pause: () => void;
  release: () => void;
  setPlaybackRate: (rate: number) => void;
  beginScrub: () => void;
  endScrub: (seconds: number) => Promise<void>;
  isPlaying: boolean;
  progress: number;
  progressSV: SharedValue<number>;
  duration: number;
  isDecoding: boolean;
  isLoaded: boolean;
  /**
   * `isLoaded` for the *currently requested* `uri`, which is stricter than
   * `isLoaded` on its own. Callers that swap `uri` must gate on this, because
   * expo-audio replaces the source asynchronously and `isLoaded` keeps
   * reporting the previous clip as ready during that window.
   */
  isReady: boolean;
  playbackRate: number;
  isEnded: boolean;
}

type PlaybackRate = 1 | 1.5 | 2;

export const PLAYBACK_RATES: PlaybackRate[] = [1, 1.5, 2];

const SEEK_END_EPSILON = 0.15;

export const useSharedAudioPlayer = (
  uri: string | null,
  durationMsOverride?: number | null,
): SharedAudioPlayer => {
  const [progress, setProgress] = useState(0);
  const progressSV = useSharedValue(0);

  const [duration, setDuration] = useState(0);

  const isOggSource = useMemo(
    () => isIOS && !!uri && /\.(ogg|opus)$/i.test(uri),
    [uri],
  );
  const [playableSource, setPlayableSource] = useState<string | null>(
    isOggSource ? null : uri,
  );
  /** The `uri` whose source is installed in the player right now. */
  const boundUriRef = useRef<string | null>(null);
  /** The `uri` that most recently completed a load. */
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const wasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!uri) {
      setPlayableSource(null);
      boundUriRef.current = null;
      return;
    }

    if (!isOggSource) {
      setPlayableSource(uri);
      boundUriRef.current = uri;
      return;
    }

    setPlayableSource(null);
    boundUriRef.current = null;

    const commitDerived = (derivedUri: string): void => {
      if (cancelled) return;
      setPlayableSource(derivedUri);
      boundUriRef.current = uri;
    };

    // iOS has no native Ogg Opus player, so an Ogg source needs a CAF copy
    // derived on demand. remuxToCafForPlayback() caches that per source path,
    // so repeat plays of the same clip reuse the file instead of remuxing it
    // again. The derived file is left in place for the cache sweeper to reap.
    const fallbackToWav = (reason: string): void => {
      logger.error("[SharedAudioPlayer] iOS Ogg remux-to-CAF failed:", reason);
      AudioTranscoder.decodeToWav(uri).then((wavResult) => {
        if (cancelled) return;
        if (wavResult.ok) {
          commitDerived(wavResult.value.uri);
        } else {
          logger.error(
            "[SharedAudioPlayer] iOS Ogg decode fallback failed:",
            wavResult.error,
          );
          setPlayableSource(uri);
          boundUriRef.current = uri;
        }
      });
    };

    AudioTranscoder.remuxToCafForPlayback(uri)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          commitDerived(result.value);
        } else {
          fallbackToWav(result.error);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        fallbackToWav(error instanceof Error ? error.message : String(error));
      });

    return (): void => {
      cancelled = true;
    };
  }, [uri, isOggSource]);

  const [isEnded, setIsEnded] = useState(false);

  const knownDuration =
    durationMsOverride && durationMsOverride > 0
      ? durationMsOverride / 1000
      : null;

  const isScrubbingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isEndedRef = useRef(false);
  const didJustFinishRef = useRef(false);
  const resumeAfterScrubRef = useRef(false);
  const releasedRef = useRef(false);

  const focusRef = useRef(createAudioFocus());
  const pauseRef = useRef<() => void>(() => {});
  const focusClaimedRef = useRef(false);

  const player = useAudioPlayer(playableSource, { downloadFirst: true });

  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1);
  const rateSV = useSharedValue(1);

  const status = useAudioPlayerStatus(player);

  /**
   * The duration of the file that is actually loaded.
   *
   * `durationMsOverride` comes back with the artifact, so it is the only
   * number available before the clip is decoded and is a reasonable estimate
   * of it. It is not, however, the length of the audio being played: providers
   * round, and a remuxed CAF can drift a few hundred ms either way. Progress is
   * measured against this, so trusting the estimate once the real length is
   * known is what leaves the waveform parked just short of the end on a clip
   * that played all the way through.
   */
  const resolvedDuration =
    status.isLoaded && status.duration > 0
      ? status.duration
      : (knownDuration ?? status.duration);

  const isPlayingSV = useSharedValue(false);
  const isScrubbingSV = useSharedValue(false);
  const durationSV = useSharedValue(0);

  const frameCallback = useFrameCallback((info) => {
    "worklet";
    if (!isPlayingSV.value) return;
    if (isScrubbingSV.value) return;

    const dt = ((info.timeSincePreviousFrame ?? 0.016) / 1000) * rateSV.value;
    const next = progressSV.value + dt;
    progressSV.value =
      durationSV.value > 0 && next >= durationSV.value
        ? durationSV.value
        : next;
  }, false);

  const isPlaying = status.playing;

  /**
   * `isLoaded` is per-source, but expo-audio installs the new source
   * asynchronously (after `preloadAsync` resolves), so a `uri` change is
   * observable for a window while `isLoaded` still reports the *previous* clip
   * as ready. Only a false -> true transition is attributed to whichever `uri`
   * is bound at that moment, which keeps a new clip from autoplaying on the old
   * clip's readiness.
   */
  useEffect(() => {
    const loaded = status.isLoaded;
    if (loaded && !wasLoadedRef.current) {
      setLoadedUri(boundUriRef.current);
    } else if (!loaded) {
      setLoadedUri(null);
    }
    wasLoadedRef.current = loaded;
  }, [status.isLoaded]);

  // If a platform never reports the intermediate `isLoaded: false`, readiness
  // would stall forever, so fall back to the reported flag once the swap has had
  // time to land. Bounded so a genuinely slow load still gets a chance.
  useEffect(() => {
    if (!status.isLoaded || !uri || loadedUri === uri) return;
    const timer = setTimeout(() => {
      // Whatever is bound by now is the source that reported ready.
      setLoadedUri(boundUriRef.current);
    }, 500);
    return (): void => {
      clearTimeout(timer);
    };
  }, [status.isLoaded, loadedUri, uri]);

  const isReady = status.isLoaded && loadedUri === uri;

  useEffect(() => {
    isPlayingSV.value = isPlaying;
    isPlayingRef.current = isPlaying;
    frameCallback.setActive(isPlaying);
  }, [isPlaying, isPlayingSV, frameCallback]);

  useEffect(() => {
    isEndedRef.current = isEnded;
  }, [isEnded]);

  const setScrubbing = useCallback(
    (scrubbing: boolean) => {
      isScrubbingRef.current = scrubbing;
      isScrubbingSV.value = scrubbing;
    },
    [isScrubbingSV],
  );

  useEffect(() => {
    const dur = resolvedDuration;
    setDuration(dur);
    durationSV.value = dur;
    if (status.didJustFinish) {
      // The integrated counter is clamped to duration, so it lands exactly on
      // the end; the reported currentTime can stop a frame or two short of it
      // and leave the bar looking unfinished after the audio has stopped.
      progressSV.value = dur > 0 ? dur : status.currentTime;
      setProgress(status.currentTime);
      triggerHaptic();
      return;
    }
    setProgress(status.currentTime);
    progressSV.value = status.currentTime;
  }, [
    status.currentTime,
    status.didJustFinish,
    progressSV,
    durationSV,
    resolvedDuration,
  ]);

  useEffect(() => {
    if (status.didJustFinish) {
      didJustFinishRef.current = true;
      setIsEnded(true);
    }
  }, [status.didJustFinish]);

  const play = useCallback(async (): Promise<void> => {
    if (releasedRef.current) return;
    try {
      focusRef.current.claim(() => pauseRef.current());
      focusClaimedRef.current = true;
      await setAudioModeAsync({ interruptionMode: "doNotMix" });
      await setIsAudioActiveAsync(true);
      player.setPlaybackRate(playbackRate);

      const dur = resolvedDuration || player.duration;
      const atEnd =
        isEndedRef.current ||
        didJustFinishRef.current ||
        (dur > 0 && player.currentTime >= dur - SEEK_END_EPSILON);

      setIsEnded(false);
      isEndedRef.current = false;
      didJustFinishRef.current = false;

      if (atEnd) {
        player.seekTo(0);
        progressSV.value = 0;
        setProgress(0);
      }
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] Play failed:", error);
    }
  }, [player, progressSV, resolvedDuration, playbackRate]);

  const playFromStart = useCallback(async (): Promise<void> => {
    if (releasedRef.current) return;
    try {
      setIsEnded(false);
      isEndedRef.current = false;
      didJustFinishRef.current = false;
      if (playbackRate !== 1) {
        setPlaybackRateState(1);
        rateSV.value = 1;
        player.setPlaybackRate(1);
      }
      focusRef.current.claim(() => pauseRef.current());
      focusClaimedRef.current = true;
      await setAudioModeAsync({ interruptionMode: "doNotMix" });
      await setIsAudioActiveAsync(true);
      player.seekTo(0);
      progressSV.value = 0;
      setProgress(0);
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] PlayFromStart failed:", error);
    }
  }, [player, progressSV, rateSV, playbackRate]);

  const pause = useCallback((): void => {
    if (releasedRef.current) return;
    try {
      player.pause();
    } catch (error) {
      logger.debug(
        "[SharedAudioPlayer] pause skipped (player already released)",
        error instanceof Error ? error.name : String(error),
      );
    }
    setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
    setIsAudioActiveAsync(false).catch(() => {});
    if (focusClaimedRef.current) {
      focusRef.current.release();
      focusClaimedRef.current = false;
    }
  }, [player]);

  pauseRef.current = pause;

  const setPlaybackRate = useCallback(
    (rate: number) => {
      if (releasedRef.current) return;
      const next = (
        PLAYBACK_RATES.includes(rate as PlaybackRate) ? rate : 1
      ) as PlaybackRate;
      setPlaybackRateState(next);
      rateSV.value = next;
      player.setPlaybackRate(next);
    },
    [player, rateSV],
  );

  const waitForSeekSettle = useCallback(
    (target: number): Promise<void> =>
      new Promise((resolve) => {
        const deadline = Date.now() + 500;
        const tick = (): void => {
          if (
            releasedRef.current ||
            Date.now() > deadline ||
            Math.abs(player.currentTime - target) < 0.05
          ) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        tick();
      }),
    [player],
  );

  const beginScrub = useCallback((): void => {
    if (releasedRef.current) return;
    const atEnd =
      duration > 0 && progressSV.value >= duration - SEEK_END_EPSILON;
    resumeAfterScrubRef.current =
      isPlayingRef.current &&
      !isEndedRef.current &&
      !didJustFinishRef.current &&
      !atEnd;

    try {
      player.pause();
    } catch {
      // Ignored
    }

    setScrubbing(true);
  }, [player, setScrubbing, duration, progressSV]);

  const endScrub = useCallback(
    async (seconds: number): Promise<void> => {
      if (releasedRef.current) return;
      const dur = resolvedDuration || player.duration;
      const clampedPos = Math.max(0, Math.min(seconds, dur));
      const atEnd = dur > 0 && clampedPos >= dur - SEEK_END_EPSILON;
      const wasPlaying = resumeAfterScrubRef.current;
      resumeAfterScrubRef.current = false;

      setIsEnded(false);
      isEndedRef.current = false;
      didJustFinishRef.current = false;

      try {
        player.pause();
      } catch {
        // Ignored
      }

      const target = atEnd ? 0 : clampedPos;
      player.seekTo(target);
      progressSV.value = target;
      setProgress(target);

      await waitForSeekSettle(target);
      if (wasPlaying) {
        await play();
      }
      setScrubbing(false);
    },
    [
      player,
      progressSV,
      setScrubbing,
      resolvedDuration,
      waitForSeekSettle,
      play,
    ],
  );

  /**
   * Idempotent teardown.
   *
   * A player has more than one owner: the hook releases it on unmount, and
   * `Echo` also releases it on dismiss — which is always followed by an
   * unmount. Every other caller may hold the controller for the length of a
   * render. So a repeat call is the expected shape of this API, not a bug, and
   * is a no-op rather than a log line. What is worth logging is a *first*
   * release whose `remove()` threw, because that means the player was not torn
   * down by us.
   */
  const release = useCallback((): void => {
    if (releasedRef.current) return;
    releasedRef.current = true;

    if (focusClaimedRef.current) {
      focusRef.current.release();
      focusClaimedRef.current = false;
    }
    frameCallback.setActive(false);
    resumeAfterScrubRef.current = false;
    try {
      player.remove();
    } catch (error) {
      logger.debug(
        "[SharedAudioPlayer] remove() threw during release:",
        error instanceof Error ? error.name : String(error),
      );
    }
    setIsAudioActiveAsync(false).catch(() => {});
    setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
  }, [player, frameCallback]);

  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(() => {
    return (): void => {
      releaseRef.current();
    };
  }, []);

  const progressDisplay = Math.round(progress);
  const controller = useMemo(
    () => ({
      play,
      playFromStart,
      pause,
      release,
      setPlaybackRate,
      beginScrub,
      endScrub,
      isPlaying,
      progress: progressDisplay,
      progressSV,
      duration,
      isDecoding: status.isBuffering,
      isLoaded: status.isLoaded,
      isReady,
      playbackRate,
      isEnded,
    }),
    [
      play,
      playFromStart,
      pause,
      release,
      setPlaybackRate,
      beginScrub,
      endScrub,
      isPlaying,
      progressDisplay,
      progressSV,
      duration,
      status.isBuffering,
      status.isLoaded,
      isReady,
      playbackRate,
      isEnded,
    ],
  );

  return controller;
};
