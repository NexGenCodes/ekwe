import { useEffect } from "react";
import { useSharedValue, SharedValue } from "react-native-reanimated";

/**
 * Real-time amplitude metering backed by a JSI host function.
 *
 * Data path (3 hops, <16ms latency):
 *   C++ current_rms_ (atomic<float>) → JSI host function (synchronous)
 *   → JS thread rAF → SharedValue.set → Reanimated sync → UI thread bars
 *
 * Falls back to 0 (silent bars) when the JSI function is not installed
 * (e.g., iOS where JSI hasn't been ported yet).
 */
export const useMetering = (): SharedValue<number> => {
  const amplitude = useSharedValue(0);

  useEffect(() => {
    let running = true;
    let rafId: number;

    const loop = (): void => {
      if (!running) return;
      const rms = globalThis.ekweNativeGetAmplitude?.() ?? 0;
      amplitude.value = rms < 0 ? 0 : rms > 1 ? 1 : rms;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return (): void => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [amplitude]);

  return amplitude;
};
