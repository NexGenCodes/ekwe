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
import logger from "@/utils/logger";
import { createAudioFocus } from "@/hooks/audio/audioFocus";
import { toFileUri } from "@/utils/fileUri";

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
  /** True when the requested `uri` is loaded, stricter than `isLoaded` during source swaps. */
  isReady: boolean;
  playbackRate: number;
  isEnded: boolean;
  /** Non-null when the requested source failed to load and is not playable. */
  loadError: string | null;
  /** Re-attempts loading a source that previously failed. */
  retryLoad: () => void;
}

type PlaybackRate = 1 | 1.5 | 2;

export const PLAYBACK_RATES: PlaybackRate[] = [1, 1.5, 2];

const SEEK_END_EPSILON = 0.15;

// Keeps the tail of a path (file name) so playback logs stay greppable without
// dumping full cache paths into every line.
const shortUri = (value: string | null | undefined): string | null =>
  value ? value.slice(-56) : null;

// Attributes every log line to one mount of one surface. Without this the
// "load -> instant end" loops in the share flow cannot be told apart from
// multiple screens each owning a player. Remove with the playback audit.
let nextPlayerInstanceId = 0;

export const useSharedAudioPlayer = (
  uri: string | null,
  durationMsOverride?: number | null,
): SharedAudioPlayer => {
  const [progress, setProgress] = useState(0);
  // Consumers only ever see whole seconds, so skipping updates that do not
  // change the rounded value keeps playback from re-rendering the whole
  // consumer tree on every status tick.
  const commitProgress = useCallback((next: number): void => {
    setProgress((prev) =>
      Math.round(prev) === Math.round(next) ? prev : next,
    );
  }, []);
  const progressSV = useSharedValue(0);

  const [duration, setDuration] = useState(0);

  // Ogg Opus is not guaranteed playable on every device (a foreign source's
  // malformed final Ogg page can collapse the duration to 0), so Ogg always
  // derives an M4A/AAC-LC playback copy before reaching the player.
  const isOggSource = useMemo(() => !!uri && /\.(ogg|opus)$/i.test(uri), [uri]);
  const [playableSource, setPlayableSource] = useState<string | null>(
    isOggSource ? null : uri,
  );
  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = ++nextPlayerInstanceId;
  }
  const instanceId = instanceIdRef.current;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  /** The `uri` whose source is installed in the player right now. */
  const boundUriRef = useRef<string | null>(null);
  /** The `uri` that most recently completed a load. */
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const wasLoadedRef = useRef(false);
  /** Latest `uri` prop, for effects that must not re-run when it changes. */
  const uriRef = useRef(uri);
  uriRef.current = uri;

  useEffect(() => {
    let cancelled = false;

    if (!uri) {
      setPlayableSource(null);
      boundUriRef.current = null;
      setLoadError(null);
      return;
    }

    if (!isOggSource) {
      setPlayableSource(uri);
      boundUriRef.current = uri;
      setLoadError(null);
      return;
    }

    setPlayableSource(null);
    boundUriRef.current = null;
    setLoadError(null);

    const commitDerived = (derivedUri: string): void => {
      if (cancelled) return;
      setPlayableSource(derivedUri);
      boundUriRef.current = uri;
      setLoadError(null);
    };

    // No platform is guaranteed to play Ogg Opus; decode to M4A with disk caching.
    const fallbackToWav = (reason: string): void => {
      logger.error("[SharedAudioPlayer] Ogg decode-to-M4A failed:", reason);
      AudioTranscoder.decodeToWav(uri)
        .then((wavResult) => {
          if (cancelled) return;
          if (wavResult.ok) {
            commitDerived(wavResult.value.uri);
          } else {
            logger.error(
              "[SharedAudioPlayer] Ogg decode fallback failed:",
              wavResult.error,
            );
            setPlayableSource(uri);
            boundUriRef.current = uri;
            setLoadError("This audio could not be decoded for playback.");
          }
        })
        .catch((err) => {
          if (cancelled) return;
          logger.error("[SharedAudioPlayer] Ogg decodeToWav exception:", err);
          setPlayableSource(uri);
          boundUriRef.current = uri;
          setLoadError("This audio could not be decoded for playback.");
        });
    };

    AudioTranscoder.createPlaybackCopyForPlayback(uri)
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
  }, [uri, isOggSource, reloadNonce]);

  // Reset playback state when the audio source changes so stale
  // "ended" flags from a previous clip cannot block replay.
  useEffect(() => {
    setIsEnded(false);
    isEndedRef.current = false;
    didJustFinishRef.current = false;
    progressSV.value = 0;
    commitProgress(0);
  }, [uri, progressSV, commitProgress]);

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
  /**
   * Bumped on every stop. A start that is still awaiting the audio session
   * checks it before touching the native player, so a clip cannot come back
   * to life after it was stopped or replaced.
   */
  const startTokenRef = useRef(0);

  const playerSource = useMemo(
    () => (playableSource ? (toFileUri(playableSource) ?? null) : null),
    [playableSource],
  );
  const player = useAudioPlayer(playerSource, { downloadFirst: true });

  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1);
  const rateSV = useSharedValue(1);

  const status = useAudioPlayerStatus(player);

  /**
   * The actual duration of the loaded audio, falling back to the override estimate.
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

    const dt = ((info.timeSincePreviousFrame ?? 16.6) / 1000) * rateSV.value;
    const next = progressSV.value + dt;
    progressSV.value =
      durationSV.value > 0 && next >= durationSV.value
        ? durationSV.value
        : next;
  }, false);

  const isPlaying = status.playing;

  /** Attributes `isLoaded` transitions to the correct URI during async source swaps. */
  useEffect(() => {
    const loaded = status.isLoaded;
    if (loaded && !wasLoadedRef.current) {
      setLoadedUri(boundUriRef.current);
    } else if (!loaded) {
      setLoadedUri(null);
    }
    wasLoadedRef.current = loaded;
  }, [status.isLoaded]);

  // Fallback timer for platforms that don't report intermediate `isLoaded: false`.
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

  // App-wide playback diagnostics: every surface that plays audio goes through
  // this hook, so these two effects cover load/playback state and failures
  // everywhere. Remove once the playback investigation is closed.
  useEffect(() => {
    logger.debug(
      "[Playback] source",
      JSON.stringify({
        id: instanceId,
        uri: shortUri(uri),
        ogg: isOggSource,
        playable: shortUri(playableSource),
        loaded: status.isLoaded,
        state: status.playbackState,
        error: loadError,
      }),
    );
    // Diagnostic snapshot on source/load changes only: depending on
    // currentTime/playbackState here would re-log on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    uri,
    isOggSource,
    playableSource,
    status.isLoaded,
    loadError,
    instanceId,
  ]);

  useEffect(() => {
    if (loadError) {
      logger.error("[Playback] load failed:", loadError, shortUri(uri));
    }
  }, [loadError, uri]);

  useEffect(() => {
    isPlayingSV.value = isPlaying;
    isPlayingRef.current = isPlaying;
    frameCallback.setActive(isPlaying);
    logger.debug(
      isPlaying ? "[Playback] started" : "[Playback] stopped",
      "id=" + instanceId,
      shortUri(uriRef.current),
    );
    // `uri` is deliberately not a dependency: a source swap mid-playback used
    // to re-run this effect and log a phantom "started" for a null uri.
  }, [isPlaying, isPlayingSV, frameCallback, instanceId]);

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
    // Only clamp to end when audio finished and is not actively playing.
    if (status.didJustFinish && !status.playing && !didJustFinishRef.current) {
      progressSV.value = dur > 0 ? dur : status.currentTime;
      commitProgress(status.currentTime);
      triggerHaptic();
      return;
    }
    commitProgress(status.currentTime);
    progressSV.value = status.currentTime;
  }, [
    status.currentTime,
    status.didJustFinish,
    status.playing,
    progressSV,
    durationSV,
    resolvedDuration,
    commitProgress,
  ]);

  useEffect(() => {
    if (status.didJustFinish) {
      didJustFinishRef.current = true;
      setIsEnded(true);
      // ExoPlayer keeps playWhenReady=true at STATE_ENDED, so any native
      // re-prepare of the finished source re-fires didJustFinish endlessly.
      // Flatten playWhenReady once so a re-prepare lands READY at the end
      // without transitioning to ENDED again. Replay still works because
      // play() seeks to 0 first.
      try {
        player.pause();
      } catch {
        // Ignored
      }
      logger.debug(
        "[Playback] ended",
        "id=" + instanceId,
        "state=" + status.playbackState,
        "t=" + status.currentTime.toFixed(2),
        shortUri(uri),
      );
    }
  }, [
    status.didJustFinish,
    status.playbackState,
    status.currentTime,
    player,
    uri,
    instanceId,
  ]);

  const play = useCallback(async (): Promise<void> => {
    if (releasedRef.current) return;
    const token = startTokenRef.current;
    try {
      focusRef.current.claim(() => pauseRef.current());
      focusClaimedRef.current = true;
      await setAudioModeAsync({
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
      });
      await setIsAudioActiveAsync(true);
      // Stopped while the audio session was being claimed: stay silent.
      if (releasedRef.current || token !== startTokenRef.current) return;
      player.setPlaybackRate(playbackRate);

      const dur = resolvedDuration || player.duration;
      const atEnd =
        isEndedRef.current ||
        didJustFinishRef.current ||
        (dur > 0 && player.currentTime >= dur - SEEK_END_EPSILON);

      setIsEnded(false);
      isEndedRef.current = false;
      didJustFinishRef.current = false;

      // Seek before play to prevent the replay-from-end bug.
      if (atEnd) {
        await player.seekTo(0);
        progressSV.value = 0;
        commitProgress(0);
      }
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] Play failed:", error);
    }
  }, [player, progressSV, resolvedDuration, playbackRate, commitProgress]);

  const playFromStart = useCallback(async (): Promise<void> => {
    if (releasedRef.current) return;
    const token = startTokenRef.current;
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
      await setAudioModeAsync({
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
      });
      await setIsAudioActiveAsync(true);
      // Stopped while the audio session was being claimed: stay silent.
      if (releasedRef.current || token !== startTokenRef.current) return;
      try {
        await player.seekTo(0);
      } catch (error) {
        logger.warn("[SharedAudioPlayer] seekTo(0) failed:", error);
      }
      // The stop may have landed during the seek as well.
      if (releasedRef.current || token !== startTokenRef.current) return;
      progressSV.value = 0;
      commitProgress(0);
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] PlayFromStart failed:", error);
    }
  }, [player, progressSV, rateSV, playbackRate, commitProgress]);

  const pause = useCallback((): void => {
    if (releasedRef.current) return;
    // Invalidate any start that is still waiting on the audio session.
    startTokenRef.current += 1;
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

  // A source revoked or replaced mid-playback must not keep playing: the
  // dictation store resets capturedUri on commit/cancel while the preview is
  // still audible, and without this the orphaned clip plays out on its own.
  useEffect(() => {
    if (isPlayingRef.current) pauseRef.current();
  }, [uri]);

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
      commitProgress(target);

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
      commitProgress,
    ],
  );

  /** Idempotent teardown. Safe to call multiple times across hook and parent lifetimes. */
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
      const message =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      // expo-audio frees the native player on its own unmount/source swap, so our
      // trailing remove() can hit an already-released handle. That is expected
      // teardown noise, not a playback failure.
      if (message.includes("already released")) {
        logger.debug(
          "[Playback] release skipped",
          "id=" + instanceId,
          shortUri(uri),
        );
      } else {
        logger.warn(
          "[Playback] release remove() failed:",
          message,
          "id=" + instanceId,
          shortUri(uri),
        );
      }
    }
    setIsAudioActiveAsync(false).catch(() => {});
    setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
  }, [player, frameCallback, uri, instanceId]);

  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(() => {
    logger.debug("[Playback] mount", "id=" + instanceId, shortUri(uri));
    return (): void => {
      logger.debug("[Playback] unmount", "id=" + instanceId, shortUri(uri));
      releaseRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const retryLoad = useCallback((): void => {
    setReloadNonce((n) => n + 1);
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
      loadError,
      retryLoad,
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
      loadError,
      retryLoad,
    ],
  );

  return controller;
};
