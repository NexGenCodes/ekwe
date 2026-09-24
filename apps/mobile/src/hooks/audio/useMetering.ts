import { useEffect } from "react";
import { useSharedValue, SharedValue } from "react-native-reanimated";

import { ekweAudio } from "../../../modules/ekwe-native";

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
