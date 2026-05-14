import * as Haptics from 'expo-haptics';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AudioContext,
  AudioBufferSourceNode,
  AudioBuffer,
  AudioManager,
} from 'react-native-audio-api';
import { useSharedValue, SharedValue } from 'react-native-reanimated';

import logger from '@/utils/logger';

// Module-level singleton — survives component unmounts for zero-latency re-mount
let _sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_sharedAudioContext) {
    _sharedAudioContext = new AudioContext();
  }
  return _sharedAudioContext;
}

/** Pre-warm the audio engine. Call early to eliminate cold-start latency. */
export const preWarmAudioEngine = (): void => {
  getAudioContext();
};

export interface SharedAudioPlayer {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => Promise<void>;
  cleanup: () => void;
  isPlaying: boolean;
  progress: number;
  progressSV: SharedValue<number>; // Smooth progress for animations
  duration: number;
  isDecoding: boolean;
  isLoaded: boolean;
  realWaveform: number[]; // Extracted from actual audio data
}

/**
 * useSharedAudioPlayer
 *
 * Production-grade audio player using the react-native-audio-api (JSI/C++).
 * Bypasses native iOS Opus limitations by decoding to PCM manually.
 * Includes "Zero-Wait" proactive decoding.
 */
export const useSharedAudioPlayer = (uri: string | null): SharedAudioPlayer => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressSV = useSharedValue(0);

  const [duration, setDuration] = useState(0);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [realWaveform, setRealWaveform] = useState<number[]>([]);

  // Ref to avoid stale closures in setInterval callbacks
  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Imperatively stop playback and release all audio resources. */
  const releaseResources = useCallback((): void => {
    logger.info('[SharedAudioPlayer] releaseResources() called');
    stopProgressTimer();
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // Ignore — source may have already finished
      }
      sourceRef.current = null;
    }
    bufferRef.current = null;
    setIsPlaying(false);
    if (contextRef.current && contextRef.current.state !== 'closed') {
      contextRef.current.suspend().catch(() => {});
    }
    AudioManager.setAudioSessionActivity(false).catch(() => {});
  }, [stopProgressTimer]);

  // Initialize and proactively decode
  useEffect(() => {
    logger.info(
      '[SharedAudioPlayer] Effect fired. URI:',
      uri ? uri.substring(0, 60) + '...' : 'null',
    );

    if (!uri) {
      logger.info('[SharedAudioPlayer] No URI — skipping decode');
      setIsLoaded(false);
      setRealWaveform([]);
      progressSV.value = 0;
      return;
    }

    const init = async (): Promise<void> => {
      try {
        setIsDecoding(true);
        setIsLoaded(false);

        // 1. Setup Context
        contextRef.current = getAudioContext();
        logger.info(
          '[SharedAudioPlayer] AudioContext state:',
          contextRef.current.state,
        );

        // 2. Proactive Decode (High-Performance JSI)
        // Note: react-native-audio-api handled the Opus/Ogg decoding internally
        logger.info('[SharedAudioPlayer] Starting decodeAudioData...');
        const decodedBuffer = await contextRef.current.decodeAudioData(uri);
        logger.info(
          '[SharedAudioPlayer] Decode SUCCESS. Duration:',
          decodedBuffer.duration,
          'Channels:',
          decodedBuffer.numberOfChannels,
          'SampleRate:',
          decodedBuffer.sampleRate,
        );
        bufferRef.current = decodedBuffer;
        setDuration(decodedBuffer.duration);

        // 3. Extract "Real Shape" for Waveform (50 buckets)
        const channelData = decodedBuffer.getChannelData(0); // Use first channel
        const bucketSize = Math.floor(channelData.length / 50);
        const peaks: number[] = [];
        let maxPeak = 0;

        for (let i = 0; i < 50; i++) {
          let max = 0;
          for (let j = 0; j < bucketSize; j++) {
            const val = Math.abs(channelData[i * bucketSize + j]);
            if (val > max) max = val;
          }
          // Visual compression: make peaks more expressive
          const peak = Math.pow(max, 0.7);
          if (peak > maxPeak) maxPeak = peak;
          peaks.push(peak);
        }

        // Final normalization: ensure the waveform always reaches near-full height
        const normalizedPeaks =
          maxPeak > 0.01 ? peaks.map((p) => p / maxPeak) : peaks;

        setRealWaveform(normalizedPeaks);
        logger.info(
          '[SharedAudioPlayer] Waveform extracted. Peaks count:',
          normalizedPeaks.length,
        );

        setIsDecoding(false);
        setIsLoaded(true);
        logger.info('[SharedAudioPlayer] ✅ Audio fully loaded and ready');
      } catch (error) {
        logger.error('[SharedAudioPlayer] ❌ Decode FAILED:', error);
        setIsDecoding(false);
        setIsLoaded(false);
      }
    };

    init();

    return (): void => {
      releaseResources();
    };
  }, [uri, releaseResources, progressSV]);

  const handlePlaybackEnd = useCallback(() => {
    setIsPlaying(false);
    // Pause at the end instead of resetting
    setProgress(duration);
    progressSV.value = duration;
    pausedAtRef.current = duration;
    stopProgressTimer();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [stopProgressTimer, duration, progressSV]);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    // High-frequency updates (60fps) for the shared value, low-frequency (10fps) for React state
    let lastStateUpdate = 0;

    timerRef.current = setInterval(() => {
      if (contextRef.current && isPlayingRef.current) {
        const currentPos =
          contextRef.current.currentTime -
          startTimeRef.current +
          pausedAtRef.current;

        if (currentPos >= duration) {
          handlePlaybackEnd();
        } else {
          // Update SharedValue (60fps smooth)
          progressSV.value = currentPos;

          // Update React state (10fps for text timer performance)
          const now = Date.now();
          if (now - lastStateUpdate > 100) {
            setProgress(currentPos);
            lastStateUpdate = now;
          }
        }
      }
    }, 16); // 60fps internal clock
  }, [duration, handlePlaybackEnd, stopProgressTimer, progressSV]);

  const play = async (): Promise<void> => {
    if (isPlayingRef.current) {
      logger.info('[SharedAudioPlayer] Already playing, ignoring play() call.');
      return;
    }

    logger.info(
      '[SharedAudioPlayer] play() called. bufferRef:',
      !!bufferRef.current,
      'contextRef:',
      !!contextRef.current,
      'isLoaded:',
      isLoaded,
    );
    if (!bufferRef.current || !contextRef.current) {
      logger.warn(
        '[SharedAudioPlayer] play() aborted — missing buffer or context',
      );
      return;
    }

    try {
      if (contextRef.current.state === 'suspended') {
        logger.info('[SharedAudioPlayer] Resuming suspended AudioContext...');
        await contextRef.current.resume();
      }

      // Configure Audio Session to pause other apps when we play
      try {
        AudioManager.setAudioSessionOptions({
          iosCategory: 'playback',
          iosMode: 'default',
          iosOptions: ['duckOthers'],
        });
        await AudioManager.setAudioSessionActivity(true);
        AudioManager.observeAudioInterruptions('gainTransientMayDuck');
      } catch (e) {
        logger.warn(
          '[SharedAudioPlayer] Could not set audio session focus:',
          e,
        );
      }

      // If we're at the very end of the track, restart from the beginning
      if (pausedAtRef.current >= duration - 0.05) {
        pausedAtRef.current = 0;
        setProgress(0);
        progressSV.value = 0;
      }

      // Web Audio API logic: Create new source per play
      const source = contextRef.current.createBufferSource();

      const offsetSeconds = pausedAtRef.current;
      if (offsetSeconds > 0.05) {
        // PRO-LEVEL POLYFILL: The underlying C++ JSI node ignores source.start(when, offset)
        // We bypass this entirely by slicing the raw PCM Float32Array and creating a functionally exact cropped buffer.
        const startFrame = Math.floor(
          offsetSeconds * contextRef.current.sampleRate,
        );
        const originalData = bufferRef.current.getChannelData(0);
        const remainingFrames = originalData.length - startFrame;

        if (remainingFrames > 0) {
          const slicedBuffer = contextRef.current.createBuffer(
            1,
            remainingFrames,
            contextRef.current.sampleRate,
          );
          slicedBuffer.getChannelData(0).set(originalData.subarray(startFrame));
          source.buffer = slicedBuffer;
        } else {
          source.buffer = bufferRef.current;
        }
      } else {
        source.buffer = bufferRef.current;
      }

      source.connect(contextRef.current.destination);

      sourceRef.current = source;
      startTimeRef.current = contextRef.current.currentTime;

      // Start at 0, the offset is mathematically baked into the buffer itself
      source.start(0);
      setIsPlaying(true);
      startProgressTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      logger.error('[SharedAudioPlayer] Play failed:', error);
    }
  };

  const pause = (): void => {
    if (sourceRef.current && contextRef.current) {
      try {
        sourceRef.current.stop();
        pausedAtRef.current +=
          contextRef.current.currentTime - startTimeRef.current;
        setIsPlaying(false);
        stopProgressTimer();
      } catch {
        // Ignore
      }
      AudioManager.setAudioSessionActivity(false).catch(() => {});
    }
  };

  const seek = async (seconds: number): Promise<void> => {
    if (!contextRef.current || !bufferRef.current) return;
    const clampedPos = Math.max(0, Math.min(seconds, duration));
    pausedAtRef.current = clampedPos;
    setProgress(clampedPos);
    progressSV.value = clampedPos;

    if (isPlayingRef.current) {
      // Seamless swap: stop old source, create new one at the new offset
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          /* already stopped */
        }
      }

      const source = contextRef.current.createBufferSource();
      const startFrame = Math.floor(clampedPos * contextRef.current.sampleRate);
      const originalData = bufferRef.current.getChannelData(0);
      const remainingFrames = originalData.length - startFrame;

      if (remainingFrames > 0) {
        const slicedBuffer = contextRef.current.createBuffer(
          1,
          remainingFrames,
          contextRef.current.sampleRate,
        );
        slicedBuffer.getChannelData(0).set(originalData.subarray(startFrame));
        source.buffer = slicedBuffer;
      } else {
        source.buffer = bufferRef.current;
      }

      source.connect(contextRef.current.destination);
      sourceRef.current = source;
      startTimeRef.current = contextRef.current.currentTime;
      source.start(0);
    }
  };

  return {
    play,
    pause,
    seek,
    cleanup: releaseResources,
    isPlaying,
    progress,
    progressSV,
    duration,
    isDecoding,
    isLoaded,
    realWaveform,
  };
};
