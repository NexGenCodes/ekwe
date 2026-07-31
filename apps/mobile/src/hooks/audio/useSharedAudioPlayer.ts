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
  pauseTimer: () => void;
  resumeTimer: () => void;
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
  const isScrubbingRef = useRef(false);

  const player = useAudioPlayer(uri, { downloadFirst: true });

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

  const timerRef = useRef<number | null>(null);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current !== null) {
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    let lastStateUpdate = 0;

    const loop = (): void => {
      if (isScrubbingRef.current) {
        timerRef.current = requestAnimationFrame(loop);
        return;
      }

      const currentTime = player.currentTime;
      const dur = player.duration;

      if (currentTime >= dur && dur > 0) {
        progressSV.value = dur;
        setProgress(dur);
        stopProgressTimer();
        triggerHaptic();
        return;
      }

      progressSV.value = currentTime;
      const now = Date.now();
      if (now - lastStateUpdate > 100) {
        setProgress(currentTime);
        lastStateUpdate = now;
      }

      timerRef.current = requestAnimationFrame(loop);
    };

    timerRef.current = requestAnimationFrame(loop);
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
      if (player.currentTime >= player.duration && player.duration > 0) {
        player.seekTo(0);
        progressSV.value = 0;
        setProgress(0);
      }
      player.play();
      triggerHaptic();
    } catch (error) {
      logger.error("[SharedAudioPlayer] Play failed:", error);
    }
  }, [player, progressSV]);

  const pause = useCallback((): void => {
    player.pause();
  }, [player]);

  const seekLockRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seek = useCallback(
    async (seconds: number): Promise<void> => {
      const clampedPos = Math.max(0, Math.min(seconds, player.duration));

      // Lock timer to prevent rubber-banding while native seek executes
      isScrubbingRef.current = true;
      if (seekLockRef.current) clearTimeout(seekLockRef.current);

      player.seekTo(clampedPos);
      progressSV.value = clampedPos;
      setProgress(clampedPos);

      // Release lock after a short buffer to allow native currentTime to catch up
      seekLockRef.current = setTimeout(() => {
        isScrubbingRef.current = false;
        seekLockRef.current = null;
      }, 150);
    },
    [player, progressSV],
  );

  const cleanup = useCallback((): void => {
    stopProgressTimer();
    if (seekLockRef.current) clearTimeout(seekLockRef.current);
    player.pause();
    player.replace(null);
    setIsAudioActiveAsync(false).catch(() => {});
  }, [player, stopProgressTimer]);

  const pauseTimer = useCallback(() => {
    isScrubbingRef.current = true;
  }, []);

  const resumeTimer = useCallback(() => {
    if (!seekLockRef.current) {
      isScrubbingRef.current = false;
    }
  }, []);

  return {
    play,
    pause,
    seek,
    cleanup,
    pauseTimer,
    resumeTimer,
    isPlaying: player.playing,
    progress,
    progressSV,
    duration,
    isDecoding,
    isLoaded,
  };
};
