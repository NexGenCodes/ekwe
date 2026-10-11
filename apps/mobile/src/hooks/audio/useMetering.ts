import { useEffect } from "react";
import { useSharedValue, SharedValue } from "react-native-reanimated";

import { ekweAudio } from "../../../modules/ekwe-native";
import { AudioCapture } from "@/services/audioCapture";

const POLL_INTERVAL_MS = 66;

const clamp = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

export const useMetering = (isActive: boolean): SharedValue<number> => {
  const amplitude = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      amplitude.value = 0;
      return;
    }

    const unsubscribe = AudioCapture.addListener((value) => {
      amplitude.value = clamp(value);
    });

    let running = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = (): void => {
      if (!running || AudioCapture.isRecording()) return;
      amplitude.value = clamp(ekweAudio.getAmplitude());
      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);

    return (): void => {
      running = false;
      unsubscribe();
      if (timeoutId !== null) clearTimeout(timeoutId);
      amplitude.value = 0;
    };
  }, [amplitude, isActive]);

  return amplitude;
};
