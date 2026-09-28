import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { observable } from "@legendapp/state";

import { EkweError, ErrorMessages } from "@/constants/errors";
import { AudioCapture } from "@/services/audioCapture";
import { StreamTranscriber } from "@/services/streamTranscriber";
import { batchTranscriber } from "@/services/batchTranscriber";
import { audioActions, RecordingState } from "@/store";
import { getToken } from "@/store/auth";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { logger } from "@/utils";
import { getWorkerUrl } from "@/utils/http";

export const TIMER_TICK_MS = 250;
export const KEEP_AWAKE_TAG = "ekwe-dictation-recording";

const START_TIMEOUT_MS = 10_000;

const MIN_RECORD_MS = 250;

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

export const dictation$ = observable<MachineState>({ ...INITIAL_STATE });

let abortController: AbortController | null = null;
export let timerInterval: NodeJS.Timeout | null = null;
let maxDurationTimer: NodeJS.Timeout | null = null;
let startTimeout: NodeJS.Timeout | null = null;
let streamUnsub: (() => void) | null = null;

let stopInFlight = false;

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

export function setTimerInterval(id: NodeJS.Timeout): void {
  timerInterval = id;
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

      if (dictation$.status.peek() !== "initializing") {
        dictation$.status.set("error");
        dictation$.error.set(ErrorMessages[EkweError.AUDIO_RECORD_FAIL]);
        return;
      }

      const sessionId = Crypto.randomUUID();
      audioActions.setSessionId(sessionId);
      audioActions.setSourceLang(sourceLang);
      audioActions.setRecordingState(RecordingState.Recording);

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

      if (dictation$.status.peek() !== "initializing") {
        if (AudioCapture.isRecording()) {
          await AudioCapture.cancelRecording().catch(() => {});
        }
        return;
      }

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
        const removePcm = AudioCapture.addPcmChunkListener((chunk) => {
          StreamTranscriber.sendPcm(chunk.data);
        });
        streamUnsub = (): void => {
          removeCb();
          removePcm();
        };
      }

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
    if (stopInFlight) return null;
    stopInFlight = true;

    if (!AudioCapture.isRecording()) {
      stopInFlight = false;
      logger.warn(
        "[VoiceDictation] stopDictation called while native capture inactive — aborted",
      );
      dictation$.set({ ...INITIAL_STATE });
      audioActions.resetAudioState();
      return null;
    }

    dictation$.status.set("processing");

    try {
      clearTimers();
      logger.info("[VoiceDictation] Stopping recording");

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

  commitRecording(): {
    uri: string;
    durationMs: number;
    waveform: number[];
  } | null {
    const uri = dictation$.capturedUri.peek();
    if (!uri || dictation$.status.peek() !== "preview") {
      logger.warn(
        "[VoiceDictation] commitRecording called without valid preview",
      );
      return null;
    }

    const durationMs = dictation$.capturedDurationMs.peek();
    const waveform = dictation$.nativeWaveform.peek();

    audioActions.setDuration(durationMs / 1000);
    audioActions.setRecordingState(RecordingState.Done);

    dictation$.set({ ...INITIAL_STATE });
    return { uri, durationMs, waveform };
  },

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
    stopInFlight = false;
    dictation$.set({ ...INITIAL_STATE });
    audioActions.resetAudioState();
  },
};
