import * as Haptics from 'expo-haptics';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AudioContext,
  AudioBufferSourceNode,
  AudioBuffer,
} from 'react-native-audio-api';

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
  isPlaying: boolean;
  progress: number;
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

  // Initialize and proactively decode
  useEffect(() => {
    if (!uri) {
      setIsLoaded(false);
      setRealWaveform([]);
      return;
    }

    const init = async (): Promise<void> => {
      try {
        setIsDecoding(true);
        setIsLoaded(false);

        // 1. Setup Context
        contextRef.current = getAudioContext();

        // 2. Proactive Decode (High-Performance JSI)
        // Note: react-native-audio-api handled the Opus/Ogg decoding internally
        const decodedBuffer = await contextRef.current.decodeAudioData(uri);
        bufferRef.current = decodedBuffer;
        setDuration(decodedBuffer.duration);

        // 3. Extract "Real Shape" for Waveform (50 buckets)
        const channelData = decodedBuffer.getChannelData(0); // Use first channel
        const bucketSize = Math.floor(channelData.length / 50);
        const peaks: number[] = [];

        for (let i = 0; i < 50; i++) {
          let max = 0;
          for (let j = 0; j < bucketSize; j++) {
            const val = Math.abs(channelData[i * bucketSize + j]);
            if (val > max) max = val;
          }
          // Normalize to 0-1 range for Skia scaling
          // We use a small power function to make the peaks more "expressive" (visual compression)
          peaks.push(Math.pow(max, 0.7));
        }
        setRealWaveform(peaks);

        setIsDecoding(false);
        setIsLoaded(true);
      } catch (error) {
        logger.error('[SharedAudioPlayer] Decode failed:', error);
        setIsDecoding(false);
        setIsLoaded(false);
      }
    };

    init();

    return (): void => {
      stopProgressTimer();
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          // Ignore
        }
      }
      bufferRef.current = null;
    };
  }, [uri]);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePlaybackEnd = useCallback(() => {
    setIsPlaying(false);
    setProgress(0);
    pausedAtRef.current = 0;
    stopProgressTimer();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [stopProgressTimer]);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    timerRef.current = setInterval(() => {
      if (contextRef.current && isPlayingRef.current) {
        const currentPos =
          contextRef.current.currentTime -
          startTimeRef.current +
          pausedAtRef.current;
        if (currentPos >= duration) {
          handlePlaybackEnd();
        } else {
          setProgress(currentPos);
        }
      }
    }, 100);
  }, [duration, handlePlaybackEnd]);

  const play = async (): Promise<void> => {
    if (!bufferRef.current || !contextRef.current) return;

    try {
      if (contextRef.current.state === 'suspended') {
        await contextRef.current.resume();
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
    }
  };

  const seek = async (seconds: number): Promise<void> => {
    if (!contextRef.current) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) pause();
    pausedAtRef.current = Math.max(0, Math.min(seconds, duration));
    setProgress(pausedAtRef.current);
    if (wasPlaying) await play();
  };

  return {
    play,
    pause,
    seek,
    isPlaying,
    progress,
    duration,
    isDecoding,
    isLoaded,
    realWaveform,
  };
};
