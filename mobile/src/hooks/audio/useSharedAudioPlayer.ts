import { useAudioPlayer, setIsAudioActiveAsync } from "expo-audio";
import { triggerHaptic } from "@/utils/haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSharedValue, SharedValue } from "react-native-reanimated";

import logger from "@/utils/logger";

export interface SharedAudioPlayer {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => Promise<void>;
  cleanup: () => void;
  isPlaying: boolean;
  progress: number;
  progressSV: SharedValue<number>;
  duration: number;
  isDecoding: boolean;
  isLoaded: boolean;
}

export const useSharedAudioPlayer = (uri: string | null): SharedAudioPlayer => {
  const [progress, setProgress] = useState(0);
  const progressSV = useSharedValue(0);

  const [duration, setDuration] = useState(0);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const isPlayingRef = useRef(false);

  const player = useAudioPlayer(uri);

  useEffect(() => {
    isPlayingRef.current = player.playing;
  }, [player.playing]);

  useEffect(() => {
    setIsLoaded(player.isLoaded);
    setDuration(player.duration);
    setProgress(player.currentTime);
    progressSV.value = player.currentTime;
    setIsDecoding(player.isBuffering);
  }, [
    player.isLoaded,
    player.duration,
    player.currentTime,
    player.isBuffering,
    progressSV,
  ]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    let lastStateUpdate = 0;

    timerRef.current = setInterval(() => {
      const currentTime = player.currentTime;
      const dur = player.duration;

      if (currentTime >= dur && dur > 0) {
        progressSV.value = dur;
        setProgress(dur);
        stopProgressTimer();
        triggerHaptic();
      } else {
        progressSV.value = currentTime;
        const now = Date.now();
        if (now - lastStateUpdate > 100) {
          setProgress(currentTime);
          lastStateUpdate = now;
        }
      }
    }, 16);
  }, [player, stopProgressTimer, progressSV]);

  useEffect(() => {
    if (player.playing) {
      startProgressTimer();
    } else {
      stopProgressTimer();
    }
    return (): void => stopProgressTimer();
  }, [player.playing, startProgressTimer, stopProgressTimer]);

  const play = useCallback(async (): Promise<void> => {
    try {
      await setIsAudioActiveAsync(true);
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] Play failed:", error);
    }
  }, [player]);

  const pause = useCallback((): void => {
    player.pause();
    setIsAudioActiveAsync(false).catch(() => {});
  }, [player]);

  const seek = useCallback(
    async (seconds: number): Promise<void> => {
      const clampedPos = Math.max(0, Math.min(seconds, player.duration));
      player.seekTo(clampedPos);
      progressSV.value = clampedPos;
      setProgress(clampedPos);
    },
    [player, progressSV],
  );

  const cleanup = useCallback((): void => {
    stopProgressTimer();
    player.pause();
    player.replace(null);
    setIsAudioActiveAsync(false).catch(() => {});
  }, [player, stopProgressTimer]);

  return {
    play,
    pause,
    seek,
    cleanup,
    isPlaying: player.playing,
    progress,
    progressSV,
    duration,
    isDecoding,
    isLoaded,
  };
};
