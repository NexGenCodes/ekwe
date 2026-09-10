import { useEffect } from "react";
import { useSharedValue, SharedValue } from "react-native-reanimated";

import { ekweAudio } from "../../../modules/ekwe-native";

/**
 * Real-time amplitude metering backed by a Nitro HybridObject.
 *
 * Data path (3 hops, <16ms latency):
 *   C++ current_rms_ (atomic<float>) → Nitro JSI sync call
 *   → JS thread rAF → SharedValue.set → Reanimated sync → UI thread bars
 *
 * The rAF loop only runs while `isActive` is true, so idle screens do not
 * wake the JS thread at 60fps for no reason.
 */
export const useMetering = (isActive: boolean): SharedValue<number> => {
  const amplitude = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      amplitude.value = 0;
      return;
    }

    let running = true;
    let rafId: number;

    const loop = (): void => {
      if (!running) return;
      const rms = ekweAudio.getAmplitude();
      amplitude.value = rms < 0 ? 0 : rms > 1 ? 1 : rms;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return (): void => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [amplitude, isActive]);

  return amplitude;
};
