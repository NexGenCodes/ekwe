import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
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
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { logger } from "@/utils";

const TIMER_TICK_MS = 100;
const KEEP_AWAKE_TAG = "ekwe-dictation-recording";

// If native capture hasn't reported back within this window (audio session
// stall, module not ready, etc.), bail the init instead of leaving the UI
// stuck on the "initializing" state indefinitely.
const START_TIMEOUT_MS = 10_000;

// Sub-quarter-second clips are mis-taps or VAD glitches; transcribing silence
// wastes a request and lands a confusing result, so reject them up front.
const MIN_RECORD_MS = 250;

export type DictationStatus =
  "idle" | "initializing" | "recording" | "preview" | "processing" | "error";

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
let startTimeout: ReturnType<typeof setTimeout> | null = null;
let streamUnsub: (() => void) | null = null;

// Guards against re-entrant `stopDictation` calls (double-tap the stop button,
// a max-duration auto-stop racing a manual stop, or a VAD auto-stop racing the
// native "stopped" status event). Without it the second call can pass the
// "recording" status check and hit `AudioCapture.stopRecording()` twice.
let stopInFlight = false;

function clearTimers(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }
  if (startTimeout) {
    clearTimeout(startTimeout);
    startTimeout = null;
  }
}

const dictationActions = {
  reset(): void {
    dictation$.set({ ...INITIAL_STATE });
  },

  async startDictation(
    sourceLang: string,
    maxDurationMs: number,
    isLive: boolean = false,
  ): Promise<void> {
    try {
      if (
        dictation$.status.peek() === "error" ||
        dictation$.status.peek() === "preview"
      ) {
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
        logger.warn(
          "[VoiceDictation] startDictation called while status is:",
          dictation$.status.peek(),
        );
        return;
      }

      logger.info("[VoiceDictation] Starting dictation", {
        lang: sourceLang,
        isLive,
      });
      dictation$.set({
        ...INITIAL_STATE,
        isLive,
        status: "initializing",
      });

      // Watchdog: native capture must reach the "recording" state within the
      // budget, otherwise this session is soft-broken (permission dialog hung,
      // native module busy) and we'd sit on the "initializing" card forever.
      startTimeout = setTimeout(async () => {
        if (dictation$.status.peek() !== "initializing") return;
        logger.error(
          "[VoiceDictation] startDictation timed out during initialization",
        );
        if (AudioCapture.isRecording()) {
          await AudioCapture.cancelRecording().catch(() => {});
        }
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[EkweError.AUDIO_RECORD_FAIL]);
      }, START_TIMEOUT_MS);

      const permResult = await AudioCapture.requestPermission();
      if (!permResult.ok) {
        logger.warn("[VoiceDictation] Microphone permission denied");
        if (startTimeout) {
          clearTimeout(startTimeout);
          startTimeout = null;
        }
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[EkweError.PERMISSION_MIC]);
        return;
      }

      // The start watchdog may have already failed this session out (native
      // init stalled while the permission dialog was up). Don't resurrect a
      // flagged-error state by continuing the capture.
      if (dictation$.status.peek() !== "initializing") {
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[EkweError.AUDIO_RECORD_FAIL]);
        return;
      }

      const sessionId = Crypto.randomUUID();
      audioActions.setSessionId(sessionId);
      audioActions.setSourceLang(sourceLang);
      audioActions.setRecordingState(RecordingState.Recording);

      // Start native capture (mode depends on isLive)
      const startRecTime = Date.now();
      const startResult = await AudioCapture.startRecording(
        sessionId,
        () => {
          dictationActions.stopDictation();
        },
        isLive ? "live" : "file",
      );
      const recStartDuration = Date.now() - startRecTime;
      logger.info(
        `[Performance] AudioCapture.startRecording took: ${recStartDuration}ms`,
      );

      if (!startResult.ok) {
        logger.error(
          "[VoiceDictation] startRecording failed:",
          startResult.error,
        );
        if (startTimeout) {
          clearTimeout(startTimeout);
          startTimeout = null;
        }
        dictation$.status.set("error");
        dictation$.error.set(
          ErrorMessages[startResult.error] ??
            ErrorMessages[EkweError.AUDIO_RECORD_FAIL],
        );
        return;
      }

      // If the watchdog already failed this session while the native init was
      // running, don't let the (now stale) success overrun resurrect it — and
      // tear the just-started capture down before it leaks a session.
      if (dictation$.status.peek() !== "initializing") {
        if (AudioCapture.isRecording()) {
          await AudioCapture.cancelRecording().catch(() => {});
        }
        return;
      }

      // Connect streaming WebSocket for live mode
      if (isLive) {
        const token = getToken();
        const serverUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? "";
        if (!token || !serverUrl) {
          logger.error(
            "[VoiceDictation] Missing token or server URL for live mode",
          );
          dictation$.status.set("error");
          dictation$.error.set(
            "Cannot start live dictation: missing authentication",
          );
          await AudioCapture.cancelRecording();
          return;
        }
        StreamTranscriber.connect({
          token,
          lang: sourceLang,
          serverUrl,
          getToken,
        });

        const removeCb = StreamTranscriber.addCallback((event) => {
          if ("error" in event) return;
          dictation$.interimText.set(
            event.type === "interim"
              ? event.text
              : dictation$.interimText.peek(),
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

      // If the watchdog already failed this session while the native init was
      // running, don't let the (now stale) success overrun resurrect it — the
      // live stream subscription above must be torn down too.
      if (dictation$.status.peek() !== "initializing") {
        if (streamUnsub) {
          streamUnsub();
          streamUnsub = null;
        }
        StreamTranscriber.disconnect();
        if (AudioCapture.isRecording()) {
          await AudioCapture.cancelRecording().catch(() => {});
        }
        return;
      }

      dictation$.status.set("recording");
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      track(AnalyticsEvents.DICTATION_STARTED, {
        sourceLang,
        maxDurationMs,
        isLive,
      });

      maxDurationTimer = setTimeout(() => {
        logger.info("[VoiceDictation] Max duration reached, auto-stopping");
        dictationActions.stopDictation().catch((e) => {
          logger.error(
            "[VoiceDictation] maxDurationTimer stopDictation failed:",
            e,
          );
        });
      }, maxDurationMs);
    } catch (e) {
      logger.error(
        "[VoiceDictation] startDictation caught top-level error:",
        e,
      );
      dictation$.status.set("error");
      dictation$.error.set(
        e instanceof Error ? `startDictation: ${e.message}` : "Unknown error",
      );
      try {
        if (AudioCapture.isRecording()) {
          await AudioCapture.cancelRecording();
        }
      } catch {
        /* best-effort */
      }
    }
  },

  async stopDictation(): Promise<string | null> {
    const currentStatus = dictation$.status.peek();
    if (currentStatus !== "recording") {
      return null;
    }
    // Re-entrancy guard: VAD auto-stop, max-duration auto-stop, a manual stop
    // tap, and the native "stopped" status event can all arrive in the same
    // frame. Only the first caller proceeds; the rest observe the transitioned
    // state and bail out.
    if (stopInFlight) return null;
    stopInFlight = true;

    // The UI already shows a recording session but the native capture is gone
    // (audio-session interruption, engine error). Don't leave a stuck card:
    // back to a clean idle instead of silently no-oping — the "processing"
    // spinner would otherwise persist with no way forward.
    if (!AudioCapture.isRecording()) {
      stopInFlight = false;
      logger.warn(
        "[VoiceDictation] stopDictation called while native capture inactive — aborted",
      );
      dictation$.set({ ...INITIAL_STATE });
      audioActions.resetAudioState();
      return null;
    }

    // Set intermediate state immediately to prevent re-entrant calls
    dictation$.status.set("processing");

    try {
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
      logger.info(
        `[Performance] AudioCapture.stopRecording took: ${recStopDuration}ms`,
      );

      if (!captureResult.ok) {
        if (dictation$.status.peek() !== "preview") {
          dictation$.status.set("error");
          dictation$.error.set(
            ErrorMessages[captureResult.error] ?? "Recording failed.",
          );
        }
        logger.error(
          "[VoiceDictation] stopRecording failed:",
          captureResult.error,
        );
        return null;
      }

      const { uri, durationMs, meteringData, waveform } = captureResult.value;

      // A sub-250ms clip is not a real utterance (mis-tap, permission-dialog
      // straggler, VAD blip). Surface an empty-audio error instead of sending a
      // single decode frame to the transcription provider.
      if (
        durationMs > 0 &&
        durationMs < MIN_RECORD_MS &&
        !dictation$.isLive.peek()
      ) {
        logger.warn(
          "[VoiceDictation] Recording too short to transcribe:",
          durationMs,
        );
        try {
          const f = new File(uri);
          if (f.exists) f.delete();
        } catch {
          // best-effort cleanup
        }
        dictation$.set({ ...INITIAL_STATE });
        audioActions.resetAudioState();
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[EkweError.TOO_SHORT]);
        return null;
      }

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
    } finally {
      stopInFlight = false;
    }
  },

  async cancelDictation(): Promise<void> {
    stopInFlight = false;
    clearTimers();
    logger.info(
      "[VoiceDictation] Cancelling dictation, status:",
      dictation$.status.peek(),
    );
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
      logger.warn(
        "[VoiceDictation] confirmDictation called without valid preview",
      );
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
      invalidateUsage();

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
