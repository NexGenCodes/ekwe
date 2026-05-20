import { useEffect } from 'react';
import {
  useSharedValue,
  cancelAnimation,
  SharedValue,
} from 'react-native-reanimated';

import { AudioCapture } from '@/services/AudioCapture';

/**
 * Low-latency metering hook synced to the display refresh rate.
 * Drives a Reanimated SharedValue at ~60fps directly from the
 * react-native-audio-api AnalyserNode, skipping the React render cycle.
 *
 * No spring animation is applied here — raw normalized values (0-1)
 * are passed through with a single-frame timing so consumers can
 * apply their own smoothing without double-latency.
 */
export const useMetering = (): SharedValue<number> => {
  const amplitude = useSharedValue(0);

  useEffect(() => {
    // Set amplitude directly on the UI thread — no smoothing here.
    // Consumers (WaveBar) apply their own withTiming for the wave effect.
    // Double-wrapping withTiming causes animation conflicts.
    const unsubscribe = AudioCapture.addListener((val) => {
      amplitude.value = val;
    });

    return (): void => {
      unsubscribe();
      cancelAnimation(amplitude);
      amplitude.value = 0;
    };
  }, [amplitude]);

  return amplitude;
};
