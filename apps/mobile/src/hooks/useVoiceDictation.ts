/**
 * useVoiceDictation — React hook facade for the dictation state machine.
 *
 * All business logic (audio capture, streaming, batch transcription, timers)
 * lives in `@/store/dictationStore`. This hook adds only the React-specific
 * wiring: KeepAwake, Haptics, AppState listener, native status listener,
 * metering animation value, and the elapsed-time ticker.
 */
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSelector } from "@legendapp/state/react";
import { useCallback, useEffect } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import { useMetering } from "@/hooks/audio/useMetering";
import { usePermissions } from "@/hooks/usePermissions";
import { AudioCapture } from "@/services/AudioCapture";
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
  meteringData: number[];
  nativeWaveform: number[];
  interimText: string;
  finalText: string;
  isLive: boolean;
  startDictation: (sourceLang: string, isLive?: boolean) => Promise<void>;
  stopDictation: () => Promise<string | null>;
  confirmDictation: (sourceLang: string) => Promise<string | null>;
  cancelDictation: () => Promise<void>;
}

export function useVoiceDictation(): UseVoiceDictationReturn {
  const maxDurationMs = usePermissions().dictationDurationMs;
  const status = useSelector(() => dictation$.status.get());
  // Metering only runs while the capture is active or starting up — not idle.
  const amplitude = useMetering(
    status === "recording" || status === "initializing",
  );

  const error = useSelector(() => dictation$.error.get());
  const meteringData = useSelector(() => dictation$.meteringData.get());
  const nativeWaveform = useSelector(() => dictation$.nativeWaveform.get());
  const capturedUri = useSelector(() => dictation$.capturedUri.get());
  const interimText = useSelector(() => dictation$.interimText.get());
  const finalText = useSelector(() => dictation$.finalText.get());
  const isLive = useSelector(() => dictation$.isLive.get());
  const elapsedMs = useSelector(() => dictation$.elapsedMs.get());

  // AppState background listener — stop + cleanup
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
      // Provide immediate haptic feedback before the async native initialization
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
        const startTime = Date.now();
        setTimerInterval(
          setInterval(() => {
            dictation$.elapsedMs.set(Date.now() - startTime);
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

  return {
    status,
    amplitude,
    elapsedMs,
    maxDurationMs,
    error,
    capturedUri,
    meteringData,
    nativeWaveform,
    interimText,
    finalText,
    isLive,
    startDictation,
    stopDictation,
    confirmDictation,
    cancelDictation,
  };
}
