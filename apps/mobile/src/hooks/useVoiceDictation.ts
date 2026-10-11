import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useValue } from "@legendapp/state/react";
import { useCallback, useEffect } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import { useMetering } from "@/hooks/audio/useMetering";
import { usePermissions } from "@/hooks/usePermissions";
import { AudioCapture } from "@/services/audioCapture";
import { logger } from "@/utils";
import {
  type DictationStatus,
  dictation$,
  dictationActions,
  setTimerInterval,
  TIMER_TICK_MS,
  KEEP_AWAKE_TAG,
} from "@/store/dictationStore";

export type { DictationStatus };

export interface UseVoiceDictationReturn {
  status: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  maxDurationMs: number;
  error: string | null;
  capturedUri: string | null;
  capturedDurationMs: number;
  meteringData: number[];
  nativeWaveform: number[];
  interimText: string;
  finalText: string;
  isLive: boolean;
  startDictation: (sourceLang: string, isLive?: boolean) => Promise<void>;
  stopDictation: () => Promise<string | null>;
  confirmDictation: (sourceLang: string) => Promise<string | null>;
  commitRecording: () => {
    uri: string;
    durationMs: number;
    waveform: number[];
  } | null;
  cancelDictation: () => Promise<void>;
}

export function useVoiceDictation(): UseVoiceDictationReturn {
  const maxDurationMs = usePermissions().dictationDurationMs;
  const status = useValue(() => dictation$.status.get());

  const amplitude = useMetering(
    status === "recording" || status === "initializing",
  );

  const error = useValue(() => dictation$.error.get());
  const meteringData = useValue(() => dictation$.meteringData.get());
  const nativeWaveform = useValue(() => dictation$.nativeWaveform.get());
  const capturedUri = useValue(() => dictation$.capturedUri.get());
  const capturedDurationMs = useValue(() =>
    dictation$.capturedDurationMs.get(),
  );
  const interimText = useValue(() => dictation$.interimText.get());
  const finalText = useValue(() => dictation$.finalText.get());
  const isLive = useValue(() => dictation$.isLive.get());
  const elapsedMs = useValue(() => dictation$.elapsedMs.get());

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus): void => {
      if (nextState === "background" || nextState === "inactive") {
        if (dictation$.status.peek() === "recording") {
          logger.info("[VoiceDictation] App backgrounded, stopping dictation");
          dictationActions.cancelDictation();
        }
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return (): void => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    return AudioCapture.addStatusListener((s) => {
      if (s === "stopped" && dictation$.status.peek() === "recording") {
        dictationActions.stopDictation().catch((err) => {
          logger.warn(
            "[VoiceDictation] stopDictation from status listener failed",
            err,
          );
        });
      }
    });
  }, []);

  useEffect(() => {
    return (): void => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      dictationActions.teardown();
    };
  }, []);

  const startDictation = useCallback(
    async (sourceLang: string, isLiveMode: boolean = false): Promise<void> => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      await dictationActions
        .startDictation(sourceLang, maxDurationMs, isLiveMode)
        .catch((e) => {
          logger.error(
            "[VoiceDictation] hook startDictation caught rejection:",
            e,
          );
        });

      if (dictation$.status.peek() === "recording") {
        activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});

        const startTime = performance.now();
        setTimerInterval(
          setInterval(() => {
            const elapsed = performance.now() - startTime;
            const rounded = Math.floor(elapsed / 1000) * 1000;
            if (rounded !== dictation$.elapsedMs.peek()) {
              dictation$.elapsedMs.set(rounded);
            }
          }, TIMER_TICK_MS),
        );
      }
    },
    [maxDurationMs],
  );

  const stopDictation = useCallback(async (): Promise<string | null> => {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    return dictationActions.stopDictation();
  }, []);

  const confirmDictation = useCallback(
    async (sourceLang: string): Promise<string | null> => {
      return dictationActions.confirmDictation(sourceLang);
    },
    [],
  );

  const cancelDictation = useCallback(async (): Promise<void> => {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    await dictationActions.cancelDictation();
  }, []);

  const commitRecording = useCallback(() => {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    return dictationActions.commitRecording();
  }, []);

  return {
    status,
    amplitude,
    elapsedMs,
    maxDurationMs,
    error,
    capturedUri,
    capturedDurationMs,
    meteringData,
    nativeWaveform,
    interimText,
    finalText,
    isLive,
    startDictation,
    stopDictation,
    confirmDictation,
    commitRecording,
    cancelDictation,
  };
}
