import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useCallback, useEffect } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import { EkweError, ErrorMessages } from "@/constants/errors";
import { useMetering } from "@/hooks/audio/useMetering";
import { usePermissions } from "@/hooks/usePermissions";
import { AudioCapture } from "@/services/AudioCapture";
import { StreamTranscriber } from "@/services/StreamTranscriber";
import { batchTranscriber } from "@/services/BatchTranscriber";
import { audioActions, RecordingState } from "@/store";
import { getToken } from "@/store/auth";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { logger } from "@/utils";

const TIMER_TICK_MS = 100;
const KEEP_AWAKE_TAG = "ekwe-dictation-recording";

export type DictationStatus =
  | "idle"
  | "initializing"
  | "recording"
  | "preview"
  | "processing"
  | "error";

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

interface MachineState {
  status: DictationStatus;
  meteringData: number[];
  nativeWaveform: number[];
  error: string | null;
  capturedUri: string | null;
  capturedDurationMs: number;
  elapsedMs: number;
  interimText: string;
  finalText: string;
  isLive: boolean;
}

const INITIAL_STATE: MachineState = {
  status: "idle",
  meteringData: [],
  nativeWaveform: [],
  error: null,
  capturedUri: null,
  capturedDurationMs: 0,
  elapsedMs: 0,
  interimText: "",
  finalText: "",
  isLive: false,
};

const dictation$ = observable<MachineState>({ ...INITIAL_STATE });

let abortController: AbortController | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
let streamUnsub: (() => void) | null = null;

function clearTimers(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }
}

export const dictationActions = {
  reset(): void {
    dictation$.set({ ...INITIAL_STATE });
  },

  async startDictation(
    sourceLang: string,
    maxDurationMs: number,
    isLive: boolean = false,
  ): Promise<void> {
    try {
      if (dictation$.status.peek() === "error" || dictation$.status.peek() === "preview") {
        const uri = dictation$.capturedUri.peek();
        if (uri) {
          try {
            const f = new File(uri);
            if (f.exists) f.delete();
          } catch {
            // best-effort cleanup
          }
        }
        dictation$.set({ ...INITIAL_STATE });
      }

      if (dictation$.status.peek() !== "idle") {
        logger.warn("[VoiceDictation] startDictation called while status is:", dictation$.status.peek());
        return;
      }

      logger.info("[VoiceDictation] Starting dictation", { lang: sourceLang, isLive });
      dictation$.set({
        ...INITIAL_STATE,
        isLive,
        status: "initializing",
      });

      const permResult = await AudioCapture.requestPermission();
      if (!permResult.ok) {
        logger.warn("[VoiceDictation] Microphone permission denied");
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[EkweError.PERMISSION_MIC]);
        return;
      }

      const sessionId = Crypto.randomUUID();
      audioActions.setSessionId(sessionId);
      audioActions.setSourceLang(sourceLang);
      audioActions.setRecordingState(RecordingState.Recording);

      // Start native capture (mode depends on isLive)
      const startRecTime = Date.now();
      const startResult = await AudioCapture.startRecording(sessionId, () => {
        dictationActions.stopDictation();
      }, isLive ? "live" : "file");
      const recStartDuration = Date.now() - startRecTime;
      logger.info(`[Performance] AudioCapture.startRecording took: ${recStartDuration}ms`);
      
      if (!startResult.ok) {
        logger.error("[VoiceDictation] startRecording failed:", startResult.error);
        dictation$.status.set("error");
        dictation$.error.set(
          ErrorMessages[startResult.error] ?? ErrorMessages[EkweError.AUDIO_RECORD_FAIL],
        );
        return;
      }

      // Connect streaming WebSocket for live mode
      if (isLive) {
        const token = getToken();
        const serverUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? "";
        if (!token || !serverUrl) {
          logger.error("[VoiceDictation] Missing token or server URL for live mode");
          dictation$.status.set("error");
          dictation$.error.set("Cannot start live dictation: missing authentication");
          await AudioCapture.cancelRecording();
          return;
        }
        StreamTranscriber.connect({ token, lang: sourceLang, serverUrl });

        const removeCb = StreamTranscriber.addCallback((event) => {
          if ("error" in event) return;
          dictation$.interimText.set(
            event.type === "interim" ? event.text : dictation$.interimText.peek()
          );
          if (event.type === "final") {
            dictation$.finalText.set((prev) => prev + " " + event.text);
          }
        });
        const removeOpus = AudioCapture.addOpusPacketListener((packet) => {
          StreamTranscriber.sendOpus(packet.data);
        });
        streamUnsub = (): void => {
          removeCb();
          removeOpus();
        };
      }

      dictation$.status.set("recording");
      track(AnalyticsEvents.DICTATION_STARTED, { sourceLang, maxDurationMs, isLive });

      maxDurationTimer = setTimeout(() => {
        logger.info("[VoiceDictation] Max duration reached, auto-stopping");
        dictationActions.stopDictation().catch((e) => {
          logger.error("[VoiceDictation] maxDurationTimer stopDictation failed:", e);
        });
      }, maxDurationMs);
    } catch (e) {
      logger.error("[VoiceDictation] startDictation caught top-level error:", e);
      dictation$.status.set("error");
      dictation$.error.set(
        e instanceof Error ? `startDictation: ${e.message}` : "Unknown error",
      );
      try {
        if (AudioCapture.isRecording()) {
          await AudioCapture.cancelRecording();
        }
      } catch { /* best-effort */ }
    }
  },

  async stopDictation(): Promise<string | null> {
    const currentStatus = dictation$.status.peek();
    if (currentStatus !== "recording" || !AudioCapture.isRecording()) {
      return null;
    }

    // Set intermediate state immediately to prevent re-entrant calls
    dictation$.status.set("processing");

    clearTimers();
    logger.info("[VoiceDictation] Stopping recording");

    // Disconnect streaming first
    if (streamUnsub) {
      streamUnsub();
      streamUnsub = null;
    }
    StreamTranscriber.disconnect();

    const stopRecTime = Date.now();
    const captureResult = await AudioCapture.stopRecording();
    const recStopDuration = Date.now() - stopRecTime;
    logger.info(`[Performance] AudioCapture.stopRecording took: ${recStopDuration}ms`);
    
    if (!captureResult.ok) {
      if (dictation$.status.peek() !== "preview") {
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[captureResult.error] ?? "Recording failed.");
      }
      logger.error("[VoiceDictation] stopRecording failed:", captureResult.error);
      return null;
    }

    const { uri, durationMs, meteringData, waveform } = captureResult.value;

    if (!uri) {
      dictation$.set({ ...INITIAL_STATE });
      return null;
    }

    // Use real native waveform (60 bins from C++ get_waveform) when available
    const realWaveform = waveform ?? [];

    dictation$.set({
      ...dictation$.peek(),
      status: "preview",
      capturedUri: uri,
      capturedDurationMs: durationMs,
      meteringData: realWaveform.length > 0 ? realWaveform : meteringData,
      nativeWaveform: realWaveform,
    });

    audioActions.setDuration(durationMs / 1000);
    audioActions.setRecordingState(RecordingState.Processing);

    // For live mode, stay in preview — transcript is already in interimText/finalText
    // No auto-submit; user taps send to commit

    return uri;
  },

  async cancelDictation(): Promise<void> {
    clearTimers();
    logger.info("[VoiceDictation] Cancelling dictation, status:", dictation$.status.peek());
    track(AnalyticsEvents.DICTATION_CANCELLED, {
      status: dictation$.status.peek(),
      durationMs: dictation$.capturedDurationMs.peek(),
    });

    if (streamUnsub) {
      streamUnsub();
      streamUnsub = null;
    }
    StreamTranscriber.disconnect();

    if (AudioCapture.isRecording()) {
      await AudioCapture.cancelRecording();
    }

    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    dictation$.set({ ...INITIAL_STATE });
    audioActions.resetAudioState();
  },

  async confirmDictation(sourceLang: string): Promise<string | null> {
    const uri = dictation$.capturedUri.peek();
    if (!uri || dictation$.status.peek() !== "preview") {
      logger.warn("[VoiceDictation] confirmDictation called without valid preview");
      return null;
    }

    // For live mode, use accumulated transcript directly — no batch transcription needed
    const isLive = dictation$.isLive.peek();
    if (isLive) {
      const transcript = dictation$.finalText.peek().trim();
      if (transcript) {
        logger.info("[VoiceDictation] Live mode: using accumulated transcript");
        audioActions.appendTranscript(transcript);
        audioActions.setRecordingState(RecordingState.Done);
        dictation$.set({ ...INITIAL_STATE });
        return transcript;
      }
      // Fall through to batch transcription if no accumulated text
    }

    dictation$.status.set("processing");
    track(AnalyticsEvents.TRANSCRIBING_STARTED, {
      sourceLang,
      durationMs: dictation$.capturedDurationMs.peek(),
    });

    const controller = new AbortController();
    abortController = controller;

    try {
      logger.info("[VoiceDictation] Confirming dictation, uri:", uri);

      const result = await batchTranscriber.transcribe(
        {
          uri,
          durationMs: dictation$.capturedDurationMs.peek(),
          meteringData: dictation$.meteringData.peek(),
          waveform: dictation$.nativeWaveform.peek(),
        },
        sourceLang,
        controller.signal,
      );

      abortController = null;

      if (!result.ok) {
        if (controller.signal.aborted) {
          logger.info("[VoiceDictation] Transcription aborted");
          return null;
        }
        const msg = ErrorMessages[result.error] ?? "Transcription failed.";
        logger.error("[VoiceDictation] Transcription failed:", result.error);
        dictation$.status.set("error");
        dictation$.error.set(msg);
        audioActions.setError(result.error as EkweError);
        track(AnalyticsEvents.TRANSCRIPTION_FAILED, {
          sourceLang,
          durationMs: dictation$.capturedDurationMs.peek(),
          error: EkweError.TRANSCRIPTION_FAIL,
        });
        return null;
      }

      const { transcript, detectedLang } = result.value;

      track(AnalyticsEvents.TRANSCRIBING_COMPLETED, {
        sourceLang,
        durationMs: dictation$.capturedDurationMs.peek(),
        detectedLang,
      });
      logger.info("[VoiceDictation] Transcription success");
      audioActions.appendTranscript(transcript);
      audioActions.setRecordingState(RecordingState.Done);

      dictation$.set({ ...INITIAL_STATE });
      return transcript;
    } catch (err) {
      abortController = null;
      logger.error("[VoiceDictation] Confirm error:", err);
      track(AnalyticsEvents.TRANSCRIPTION_FAILED, {
        sourceLang,
        durationMs: dictation$.capturedDurationMs.peek(),
        error: "exception",
      });
      dictation$.status.set("error");
      dictation$.error.set("Failed to process voice input.");
      return null;
    } finally {
      try {
        const f = new File(uri);
        if (f.exists) f.delete();
      } catch {
        // cleanup best-effort
      }
    }
  },
};

export function useVoiceDictation(): UseVoiceDictationReturn {
  const maxDurationMs = usePermissions().dictationDurationMs;
  const amplitude = useMetering();

  const status = useSelector(() => dictation$.status.get());
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
    return (): void => { sub.remove(); };
  }, []);

  useEffect(() => {
    return AudioCapture.addStatusListener((s) => {
      if (s === "stopped" && dictation$.status.peek() === "recording") {
        dictationActions.stopDictation().catch((err) => {
          logger.warn("[VoiceDictation] stopDictation from status listener failed", err);
        });
      }
    });
  }, []);

  useEffect(() => {
    return (): void => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      clearTimers();
      abortController?.abort();
      if (streamUnsub) {
        streamUnsub();
        streamUnsub = null;
      }
      StreamTranscriber.disconnect();
      if (AudioCapture.isRecording()) {
        AudioCapture.cancelRecording().catch(() => {});
      }
    };
  }, []);

  const startDictation = useCallback(
    async (sourceLang: string, isLiveMode: boolean = false): Promise<void> => {
      // Provide immediate haptic feedback before the async native initialization
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      await dictationActions.startDictation(sourceLang, maxDurationMs, isLiveMode).catch((e) => {
        logger.error("[VoiceDictation] hook startDictation caught rejection:", e);
      });

      if (dictation$.status.peek() === "recording") {
        activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
        const startTime = Date.now();
        timerInterval = setInterval(() => {
          dictation$.elapsedMs.set(Date.now() - startTime);
        }, TIMER_TICK_MS);
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
