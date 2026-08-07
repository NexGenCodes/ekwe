import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";
import { triggerHaptic } from "@/utils/haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSharedValue,
  SharedValue,
  useFrameCallback,
} from "react-native-reanimated";

import logger from "@/utils/logger";
import { createAudioFocus } from "./audioFocus";

export interface SharedAudioPlayer {
  play: () => Promise<void>;
  /**
   * Restart playback of the current source from the very beginning at normal
   * speed (1x), resetting any preview scrub position or speed. Used by the
   * "play original" speaker in result steps so a tap always starts clean.
   */
  playFromStart: () => Promise<void>;
  pause: () => void;
  /**
   * Terminal: releases the native audio player, audio session and exclusive
   * focus. Irreversible — after this every method becomes a no-op. Call only
   * when the player will never be used again (flow teardown / unmount).
   */
  release: () => void;
  setPlaybackRate: (rate: number) => void;
  /**
   * Start a scrub transaction (the user grabbed the playhead). Captures whether
   * playback should resume after the scrub settles — true only when audio was
   * actively playing mid-track. Pauses playback if running and freezes the
   * progress clock for the duration of the scrub.
   */
  beginScrub: () => void;
  /**
   * End a scrub at `seconds`. Seeks the native player, waits for it to land at
   * the new position, then — only if a previously-active track was captured by
   * `beginScrub` — resumes playback. A finished/ended track never resumes.
   */
  endScrub: (seconds: number) => Promise<void>;
  isPlaying: boolean;
  progress: number;
  progressSV: SharedValue<number>;
  duration: number;
  isDecoding: boolean;
  isLoaded: boolean;
  playbackRate: number;
  isEnded: boolean;
}

type PlaybackRate = 1 | 1.5 | 2;

export const PLAYBACK_RATES: PlaybackRate[] = [1, 1.5, 2];

export const useSharedAudioPlayer = (
  uri: string | null,
  durationMsOverride?: number | null,
): SharedAudioPlayer => {
  const [progress, setProgress] = useState(0);
  const progressSV = useSharedValue(0);

  const [duration, setDuration] = useState(0);

  // True once the player has reached the end of the track. Unlike `isPlaying`,
  // this is authoritative even on paths where the native `didJustFinish` event
  // doesn't force `playing` to `false` immediately. It lets scrub-resume logic
  // distinguish "dragging a still-active track" from "dragging a finished one",
  // so seeking a completed track stays paused.
  const [isEnded, setIsEnded] = useState(false);

  // Authoritative duration (ms) computed natively from decoded PCM. When the
  // player's parsed Ogg duration under-reports (see granule handling), the
  // waveform would "fill" before playback ends; prefer this true length.
  const knownDuration =
    durationMsOverride && durationMsOverride > 0
      ? durationMsOverride / 1000
      : null;

  const isScrubbingRef = useRef(false);
  // Mirrors of live playback state read inside stable callbacks without stale
  // closures (the status/state values themselves change identity every event).
  const isPlayingRef = useRef(false);
  const isEndedRef = useRef(false);
  // Set by `beginScrub`, consumed by `endScrub`: whether audio should resume
  // once the drop-seek lands.
  const resumeAfterScrubRef = useRef(false);
  // Set once `remove()` has been called on the native player. Every public
  // method must bail early once released — calling into a removed shared
  // object throws "Cannot use shared object that was already released" (seen
  // when a late pause fired during Echo teardown).
  const releasedRef = useRef(false);

  // App-level single-audio-focus: claiming focus pauses any other app player
  // (e.g. the home dictation preview) so two doNotMix players never contend.
  const focusRef = useRef(createAudioFocus());
  // Pause is defined below; keep a ref so the focus bus always calls the latest
  // implementation without keying effects off identity churn.
  const pauseRef = useRef<() => void>(() => {});
  const focusClaimedRef = useRef(false);

  const player = useAudioPlayer(uri, { downloadFirst: true });

  // Playback speed. Kept in a shared value so the UI-thread clock advances at
  // the correct rate, and passed to the native player on change/play.
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1);
  const rateSV = useSharedValue(1);

  // `useAudioPlayerStatus` is reactive: it subscribes to playbackStatusUpdate
  // events from the native player and triggers a re-render on each change.
  // Reading `player.playing`/`player.currentTime` directly does NOT re-render,
  // which is why the progress loop never started before.
  const status = useAudioPlayerStatus(player);

  // WhatsApp-style progress clock. Native status events only arrive every
  // ~500ms; smooth 60fps motion must NOT be driven by polling the native
  // player from JS (that crosses the bridge 2x per frame and janks on
  // low-end devices). Instead a UI-thread frame callback advances a clock,
  // and status events resync it to native truth ~2x/sec + on seek.
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

  // Keep a stable progress timer that runs from a reactive `isPlaying` signal.
  // `player.currentTime` is safe to read imperatively inside the RAF loop.
  const isPlaying = status.playing;

  useEffect(() => {
    isPlayingSV.value = isPlaying;
    isPlayingRef.current = isPlaying;
    frameCallback.setActive(isPlaying);
  }, [isPlaying, isPlayingSV, frameCallback]);

  useEffect(() => {
    isEndedRef.current = isEnded;
  }, [isEnded]);

  // Shared helper so every scrub path freezes the clock the same way.
  const setScrubbing = useCallback(
    (scrubbing: boolean) => {
      isScrubbingRef.current = scrubbing;
      isScrubbingSV.value = scrubbing;
    },
    [isScrubbingSV],
  );

  useEffect(() => {
    const dur = knownDuration ?? status.duration;
    setDuration(dur);
    setProgress(status.currentTime);
    durationSV.value = dur;
    progressSV.value = status.currentTime;
    if (status.didJustFinish) {
      triggerHaptic();
    }
  }, [
    status.currentTime,
    status.duration,
    status.didJustFinish,
    progressSV,
    durationSV,
    knownDuration,
  ]);

  // Flag the track as ended when the native player reports it just finished,
  // so scrub/seek handlers can avoid autoresuming a completed track.
  useEffect(() => {
    if (status.didJustFinish) {
      setIsEnded(true);
    }
  }, [status.didJustFinish]);

  const play = useCallback(async (): Promise<void> => {
    if (releasedRef.current) return;
    try {
      setIsEnded(false);
      focusRef.current.claim(() => pauseRef.current());
      focusClaimedRef.current = true;
      // Request exclusive audio focus ('doNotMix') so any other app's audio is
      // paused while this player runs, instead of mixing over the playback.
      await setAudioModeAsync({ interruptionMode: "doNotMix" });
      await setIsAudioActiveAsync(true);
      player.setPlaybackRate(playbackRate);
      const dur = knownDuration ?? player.duration;
      if (player.currentTime >= dur && dur > 0) {
        player.seekTo(0);
        progressSV.value = 0;
        setProgress(0);
      }
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] Play failed:", error);
    }
  }, [player, progressSV, knownDuration, playbackRate]);

  // Result-step "play original": starts clean from 0:00 at normal speed,
  // ignoring any position/speed the audio footer in the preview left behind.
  const playFromStart = useCallback(async (): Promise<void> => {
    if (releasedRef.current) return;
    try {
      setIsEnded(false);
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
    player.pause();
    // Relax exclusive focus, release the audio-active flag, and yield the
    // app-level focus so another player / later text-to-speech isn't hindered
    // by a session that is (silently) still marked "active".
    setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
    setIsAudioActiveAsync(false).catch(() => {});
    if (focusClaimedRef.current) {
      focusRef.current.release();
      focusClaimedRef.current = false;
    }
  }, [player]);

  // Expose the latest `pause` to the focus bus (see delay in definition above).
  pauseRef.current = pause;

  const setPlaybackRate = useCallback(
    (rate: number) => {
      if (releasedRef.current) return;
      const next = (PLAYBACK_RATES.includes(rate as PlaybackRate)
        ? rate
        : 1) as PlaybackRate;
      setPlaybackRateState(next);
      rateSV.value = next;
      player.setPlaybackRate(next);
    },
    [player, rateSV],
  );

  // Resolves once the native player's `currentTime` has caught up to the seek
  // target, so playback resumes from the dropped position instead of the old
  // one (the blind `setTimeout` it replaces was racy on slow devices).
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
    // Resume is allowed ONLY when the audio was actively playing mid-track. A
    // paused or finished track never resumes after a scrub.
    resumeAfterScrubRef.current =
      isPlayingRef.current && !isEndedRef.current;
    if (isPlayingRef.current) player.pause();
    setScrubbing(true);
  }, [player, setScrubbing]);

  const endScrub = useCallback(
    async (seconds: number): Promise<void> => {
      if (releasedRef.current) return;
      const dur = knownDuration ?? player.duration;
      const clampedPos = Math.max(0, Math.min(seconds, dur));

      // Repositioning a completed track is allowed, but it must stay paused:
      // resume is gated entirely by what `beginScrub` captured.
      setIsEnded(false);
      isEndedRef.current = false;

      player.seekTo(clampedPos);
      progressSV.value = clampedPos;
      setProgress(clampedPos);

      // Keep the clock frozen while the native seek lands, then resume only a
      // previously-active track from the new position.
      await waitForSeekSettle(clampedPos);
      if (resumeAfterScrubRef.current) {
        resumeAfterScrubRef.current = false;
        await play();
      }
      setScrubbing(false);
    },
    [
      player,
      progressSV,
      setScrubbing,
      knownDuration,
      waitForSeekSettle,
      play,
    ],
  );

  const release = useCallback((): void => {
    if (releasedRef.current) {
      // The unmount safety-net in useAudioWaveformPlayback + onDismiss both call
      // release; a second call is expected teardown, not a bug — log at debug.
      logger.debug("[SharedAudioPlayer] release() called twice — already released");
      return;
    }
    releasedRef.current = true;

    if (focusClaimedRef.current) {
      focusRef.current.release();
      focusClaimedRef.current = false;
    }
    frameCallback.setActive(false);
    resumeAfterScrubRef.current = false;
    player.pause();
    player.remove();
    setIsAudioActiveAsync(false).catch(() => {});
    setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
  }, [player, frameCallback]);

  // Guarantee the native player, audio session and exclusive-focus mode are
  // always released when the consumer unmounts, even if it never calls
  // `release()` explicitly. `release` is idempotent, so this composes with
  // explicit callers in the echo flow.
  useEffect(() => {
    return (): void => {
      release();
    };
  }, [release]);

  return {
    play,
    playFromStart,
    pause,
    release,
    setPlaybackRate,
    beginScrub,
    endScrub,
    isPlaying,
    progress,
    progressSV,
    duration,
    isDecoding: status.isBuffering,
    isLoaded: status.isLoaded,
    playbackRate,
    isEnded,
  };
};
