/**
 * Dictation State Store — Pure state machine + actions for voice dictation.
 *
 * Contains the Legend-State observable, timer management, and all the
 * async action logic (start/stop/cancel/confirm). The React hook in
 * `useVoiceDictation.ts` composes this store with UI-only concerns
 * (KeepAwake, Haptics, AppState, metering).
 */
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { observable } from "@legendapp/state";

import { EkweError, ErrorMessages } from "@/constants/errors";
import { AudioCapture } from "@/services/AudioCapture";
import { StreamTranscriber } from "@/services/StreamTranscriber";
import { batchTranscriber } from "@/services/BatchTranscriber";
import { audioActions, RecordingState } from "@/store";
import { getToken } from "@/store/auth";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { logger } from "@/utils";
import { getWorkerUrl } from "@/utils/networkUtils";

// ─── Constants ───────────────────────────────────────────────────
export const TIMER_TICK_MS = 100;
export const KEEP_AWAKE_TAG = "ekwe-dictation-recording";

// If native capture hasn't reported back within this window (audio session
// stall, module not ready, etc.), bail the init instead of leaving the UI
// stuck on the "initializing" state indefinitely.
const START_TIMEOUT_MS = 10_000;

// Sub-quarter-second clips are mis-taps or VAD glitches; transcribing silence
// wastes a request and lands a confusing result, so reject them up front.
const MIN_RECORD_MS = 250;

// ─── Types ───────────────────────────────────────────────────────
export type DictationStatus =
  "idle" | "initializing" | "recording" | "preview" | "processing" | "error";

export interface MachineState {
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

export const INITIAL_STATE: MachineState = {
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

// ─── Observable ──────────────────────────────────────────────────
export const dictation$ = observable<MachineState>({ ...INITIAL_STATE });

// ─── Module-level mutable refs ───────────────────────────────────
let abortController: AbortController | null = null;
export let timerInterval: ReturnType<typeof setInterval> | null = null;
let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
let startTimeout: ReturnType<typeof setTimeout> | null = null;
let streamUnsub: (() => void) | null = null;

// Guards against re-entrant `stopDictation` calls (double-tap the stop button,
// a max-duration auto-stop racing a manual stop, or a VAD auto-stop racing the
// native "stopped" status event). Without it the second call can pass the
// "recording" status check and hit `AudioCapture.stopRecording()` twice.
let stopInFlight = false;

// ─── Timer helpers ───────────────────────────────────────────────
export function clearTimers(): void {
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

export function setTimerInterval(id: ReturnType<typeof setInterval>): void {
  timerInterval = id;
}

// ─── Actions ─────────────────────────────────────────────────────
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
        const serverUrl = getWorkerUrl();
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

  /** Tear down all resources — called from the hook's cleanup effect. */
  teardown(): void {
    clearTimers();
    abortController?.abort();
    abortController = null;
    if (streamUnsub) {
      streamUnsub();
      streamUnsub = null;
    }
    StreamTranscriber.disconnect();
    if (AudioCapture.isRecording()) {
      AudioCapture.cancelRecording().catch(() => {});
    }
    // Fully reset the machine, mirroring `cancelDictation`. Without this an
    // unmount mid-start (e.g. navigating away while "initializing") leaves the
    // store stuck at a non-idle status and `stopInFlight` latched, so the next
    // mount's `startDictation` bails early and the session can never recover.
    stopInFlight = false;
    dictation$.set({ ...INITIAL_STATE });
    audioActions.resetAudioState();
  },
};
