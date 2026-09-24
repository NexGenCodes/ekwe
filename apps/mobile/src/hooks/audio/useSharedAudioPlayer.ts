import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";
import { File } from "expo-file-system";
import { triggerHaptic } from "@/utils/haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSharedValue,
  SharedValue,
  useFrameCallback,
} from "react-native-reanimated";

import { AudioTranscoder } from "@/services/audioTranscoder";
import { cleanEchoCache } from "@/utils/audioCache";
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

  const { isOggSource, cafSiblingUri } = useMemo(() => {
    const isOgg = isIOS && !!uri && /\.(ogg|opus)$/i.test(uri);
    return {
      isOggSource: isOgg,
      cafSiblingUri:
        isOgg && uri ? uri.replace(/\.(ogg|opus)$/i, ".caf") : null,
    };
  }, [uri]);
  const hasCafSibling = useMemo(
    () => (cafSiblingUri ? new File(cafSiblingUri).exists : false),
    [cafSiblingUri],
  );
  const [playableSource, setPlayableSource] = useState<string | null>(
    hasCafSibling ? cafSiblingUri : isOggSource ? null : uri,
  );
  const decodedTempRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!uri) {
      const previous = decodedTempRef.current;
      if (previous) {
        decodedTempRef.current = null;
        setTimeout(() => cleanEchoCache(previous), 1000);
      }
      setPlayableSource(null);
      return;
    }

    if (!isOggSource) {
      setPlayableSource(uri);
      return;
    }

    if (hasCafSibling && cafSiblingUri) {
      const previous = decodedTempRef.current;
      if (previous) {
        decodedTempRef.current = null;
        setTimeout(() => cleanEchoCache(previous), 1000);
      }
      setPlayableSource(cafSiblingUri);
      return;
    }

    setPlayableSource(null);

    const commitTemp = (temp: string): void => {
      const previous = decodedTempRef.current;
      if (previous && previous !== temp) {
        setTimeout(() => cleanEchoCache(previous), 1000);
      }
      decodedTempRef.current = temp;
      setPlayableSource(temp);
    };

    const fallbackToWav = (reason: string): void => {
      logger.error("[SharedAudioPlayer] iOS Ogg remux-to-CAF failed:", reason);
      AudioTranscoder.decodeToWav(uri).then((wavResult) => {
        if (cancelled) {
          if (wavResult.ok) cleanEchoCache(wavResult.value.uri);
          return;
        }
        if (wavResult.ok) {
          commitTemp(wavResult.value.uri);
        } else {
          logger.error(
            "[SharedAudioPlayer] iOS Ogg decode fallback failed:",
            wavResult.error,
          );
          setPlayableSource(uri);
        }
      });
    };

    AudioTranscoder.remuxToCaf(uri)
      .then((result) => {
        if (cancelled) {
          if (result.ok) cleanEchoCache(result.value.uri);
          return;
        }
        if (result.ok) {
          commitTemp(result.value.uri);
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
  }, [uri, isOggSource, cafSiblingUri, hasCafSibling]);

  useEffect(() => {
    return (): void => {
      const temp = decodedTempRef.current;
      decodedTempRef.current = null;
      if (temp) cleanEchoCache(temp);
    };
  }, []);

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

      const dur = knownDuration ?? player.duration;
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
  }, [player, progressSV, knownDuration, playbackRate]);

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
      const dur = knownDuration ?? player.duration;
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
    [player, progressSV, setScrubbing, knownDuration, waitForSeekSettle, play],
  );

  const release = useCallback((): void => {
    if (releasedRef.current) {
      logger.debug(
        "[SharedAudioPlayer] release() called twice — already released",
      );
      return;
    }
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
        "[SharedAudioPlayer] remove during release skipped (already released)",
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
      playbackRate,
      isEnded,
    ],
  );

  return controller;
};
