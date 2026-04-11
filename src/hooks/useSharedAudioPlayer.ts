import * as Haptics from 'expo-haptics';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AudioContext,
  AudioBufferSourceNode,
  decodeAudioData,
  AudioBuffer,
} from 'react-native-audio-api';

export interface SharedAudioPlayer {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  isPlaying: boolean;
  progress: number;
  duration: number;
  isDecoding: boolean;
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
  const [realWaveform, setRealWaveform] = useState<number[]>([]);

  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize and proactively decode
  useEffect(() => {
    if (!uri) return;

    const init = async () => {
      try {
        setIsDecoding(true);

        // 1. Setup Context
        if (!contextRef.current) {
          contextRef.current = new AudioContext();
        }

        // 2. Proactive Decode (High-Performance JSI)
        // Note: react-native-audio-api handled the Opus/Ogg decoding internally
        const decodedBuffer = await decodeAudioData(uri);
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
          // Convert to dB scale similar to the app's metering (-160 to 0)
          const db = max > 0 ? Math.max(-160, 20 * Math.log10(max)) : -160;
          peaks.push(db);
        }
        setRealWaveform(peaks);

        setIsDecoding(false);
      } catch (error) {
        console.error('[SharedAudioPlayer] Decode failed:', error);
        setIsDecoding(false);
      }
    };

    init();

    return () => {
      stopProgressTimer();
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch (e) {}
      }
      // Note: We don't close the context here if we want to reuse it,
      // but cleaning up buffers is good.
      bufferRef.current = null;
    };
  }, [uri]);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    timerRef.current = setInterval(() => {
      if (contextRef.current && isPlaying) {
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
  }, [isPlaying, duration]);

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

  const play = async () => {
    if (!bufferRef.current || !contextRef.current) return;

    try {
      if (contextRef.current.state === 'suspended') {
        await contextRef.current.resume();
      }

      // Web Audio API logic: Create new source per play
      const source = contextRef.current.createBufferSource();
      source.buffer = bufferRef.current;
      source.connect(contextRef.current.destination);

      sourceRef.current = source;
      startTimeRef.current = contextRef.current.currentTime;

      source.start(0, pausedAtRef.current);
      setIsPlaying(true);
      startProgressTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error('[SharedAudioPlayer] Play failed:', error);
    }
  };

  const pause = () => {
    if (sourceRef.current && contextRef.current) {
      try {
        sourceRef.current.stop();
        pausedAtRef.current +=
          contextRef.current.currentTime - startTimeRef.current;
        setIsPlaying(false);
        stopProgressTimer();
      } catch (e) {}
    }
  };

  const seek = (seconds: number) => {
    if (!contextRef.current) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) pause();
    pausedAtRef.current = Math.max(0, Math.min(seconds, duration));
    setProgress(pausedAtRef.current);
    if (wasPlaying) play();
  };

  return {
    play,
    pause,
    seek,
    isPlaying,
    progress,
    duration,
    isDecoding,
    realWaveform,
  };
};
