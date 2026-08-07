import { useSelector } from "@legendapp/state/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { triggerHaptic } from "@/utils/haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useCallback, useReducer, useRef, useState } from "react";
import { AppState } from "react-native";

import { useEchoAudioResolver } from "./useEchoAudioResolver";

import { useTranslation } from "../useTranslation";

import { usePermissions } from "@/hooks/usePermissions";
import { batchTranscriber } from "@/services/BatchTranscriber";
import { HistoryService } from "@/services/HistoryService";
import { IntentService } from "@/services/IntentService";
import { settings$, auth$ } from "@/store";
import { EchoStep, EchoProps, UseEchoFlowResult } from "@/types/echo";
import { default as logger } from "@/utils/logger";
import { isIOS } from "@/utils/platform";
import { cleanEchoCache } from "@/utils/echo";
import { resolveDetectedLanguage, getDefaultSourceLang } from "@/utils/languageUtils";
import { checkIsOnline } from "@/utils/netInfo";

interface EchoState {
  step: EchoStep;
  selectedLang: string;
  detectedLang: string | null;
  targetLang: string;
  transcription: string | null;
  translation: string | null;
  sttProvider?: string;
  llmProvider?: string;
  audioDuration: number;
  error: string | null;
  uploadProgress: number | null;
}

type EchoAction =
  | { type: "SET_STEP"; payload: EchoStep }
  | { type: "SET_SELECTED_LANG"; payload: string }
  | { type: "SET_DETECTED_LANG"; payload: string | null }
  | { type: "SET_TARGET_LANG"; payload: string }
  | { type: "SET_TRANSCRIPTION"; payload: { text: string; provider?: string } }
  | {
      type: "SET_TRANSLATION";
      payload: { text: string | null; provider?: string };
    }
  | { type: "SET_AUDIO_DURATION"; payload: number }
  | { type: "SET_UPLOAD_PROGRESS"; payload: number | null }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "RESET" };

const echoReducer = (state: EchoState, action: EchoAction): EchoState => {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.payload };
    case "SET_SELECTED_LANG":
      return { ...state, selectedLang: action.payload };
    case "SET_DETECTED_LANG":
      return { ...state, detectedLang: action.payload };
    case "SET_TARGET_LANG":
      return { ...state, targetLang: action.payload };
    case "SET_TRANSCRIPTION":
      return {
        ...state,
        transcription: action.payload.text,
        sttProvider: action.payload.provider,
      };
    case "SET_TRANSLATION":
      return {
        ...state,
        translation: action.payload.text,
        llmProvider: action.payload.provider,
      };
    case "SET_AUDIO_DURATION":
      return { ...state, audioDuration: action.payload };
    case "SET_UPLOAD_PROGRESS":
      return { ...state, uploadProgress: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "RESET":
      return {
        ...state,
        step: "PickLanguage",
        transcription: null,
        translation: null,
        detectedLang: null,
        uploadProgress: null,
      };
    default:
      return state;
  }
};

export const useEchoFlow = (
  props: EchoProps,
  onPlayerRelease?: () => void,
): UseEchoFlowResult => {
  const permissions = usePermissions();
  const autoCopySetting = useSelector(() => settings$.autoCopy.get());
  const autoCopy = permissions.autoCopy ? autoCopySetting : false;
  const session = useSelector(() => auth$.session.get());
  const sourceApp = props.sourceApp || (isIOS ? "ios" : "");

  // Log the raw native sourceApp exactly once per mount, NOT on every render.
  // `useEchoFlow` re-renders at the native status cadence (~2 Hz during
  // playback) because `useAudioPlayerStatus` emits a fresh status object per
  // event; a body-level log would otherwise spam the console per re-render.
  const sourceAppLoggedRef = useRef(false);
  if (!sourceAppLoggedRef.current) {
    sourceAppLoggedRef.current = true;
    logger.info(
      "[EchoFlow] Raw sourceApp from native:",
      JSON.stringify(props.sourceApp),
    );
  }

  // State Machine via Reducer
  const [state, dispatch] = useReducer(echoReducer, {
    step: "PickLanguage",
    selectedLang: getDefaultSourceLang(permissions.autoLanguageDetect),
    detectedLang: null,
    targetLang: "",
    transcription: null,
    translation: null,
    sttProvider: undefined,
    llmProvider: undefined,
    audioDuration: 0,
    error: null,
    uploadProgress: null,
  });

  const setStep = useCallback(
    (step: EchoStep) => dispatch({ type: "SET_STEP", payload: step }),
    [],
  );

  // Auto-copy "copied" feedback flag: set true right after the automatic
  // clipboard write, then reset shortly after so the copy button's check
  // animation plays exactly once per auto-copy.
  const [autoCopied, setAutoCopied] = useState(false);
  const autoCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return (): void => {
      if (autoCopyTimerRef.current) clearTimeout(autoCopyTimerRef.current);
    };
  }, []);

  // Transaction refs
  const savedRef = useRef(false);
  const transcriptRef = useRef(state.transcription);
  const detectedLangRef = useRef(state.detectedLang);
  const targetLangRef = useRef(state.targetLang);
  const sttRef = useRef(state.sttProvider);
  const durationRef = useRef(state.audioDuration);

  // Abort controller for the in-flight transcribe/translate request, so the
  // user can cancel mid-processing. Only one operation runs at a time.
  const processingAbortRef = useRef<AbortController | null>(null);

  // Remembers the last failed operation + its inputs so the Error step can
  // retry with a single tap (without resetting the chosen language).
  const lastOpRef = useRef<"transcribe" | "translate" | null>(null);
  const lastTranscribeArgsRef = useRef<{
    durationSeconds: number;
    waveform: number[];
  } | null>(null);

  // Throttles upload-progress dispatches to whole-percent changes so the
  // sheet doesn't re-render on every native progress event.
  const lastUploadPctRef = useRef(-1);

  useEffect(() => {
    transcriptRef.current = state.transcription;
    detectedLangRef.current = state.detectedLang;
    targetLangRef.current = state.targetLang;
    sttRef.current = state.sttProvider;
    durationRef.current = state.audioDuration;
  }, [
    state.transcription,
    state.detectedLang,
    state.targetLang,
    state.sttProvider,
    state.audioDuration,
  ]);
  const setSelectedLang = useCallback(
    (lang: string) => dispatch({ type: "SET_SELECTED_LANG", payload: lang }),
    [],
  );
  const setTargetLang = useCallback(
    (lang: string) => dispatch({ type: "SET_TARGET_LANG", payload: lang }),
    [],
  );

  // KeepAwake is now activated only during active processing steps
  // (Transcribing / Translating) — see handleTranscribe & handleTranslate

  // API calls
  const { translate } = useTranslation();

  // ── URI Resolution Pipeline ──────────────────────────────────────────
  const {
    audioUri,
    isResolving,
    convertedWaveform,
    convertedDurationMs,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
  } = useEchoAudioResolver(props);

  // Reset state on subsequent share intents
  useEffect(() => {
    if (isSubsequentIntent) {
      dispatch({ type: "RESET" });
      savedRef.current = false;
      setIsSubsequentIntent(false);
    }
  }, [isSubsequentIntent, setIsSubsequentIntent]);

  // Transcription Logic
  const handleTranscribe = async (
    durationSeconds: number,
    waveform: number[],
  ): Promise<void> => {
    // Prefer the native duration reported during content resolution; fall back
    // to the player-derived estimate when unavailable.
    const durationMs =
      convertedDurationMs ?? Math.round(durationSeconds * 1000);
    dispatch({ type: "SET_AUDIO_DURATION", payload: durationMs / 1000 });
    logger.info("[EchoFlow] ── Initiating Transcription ──");
    logger.info("[EchoFlow] User ID:", session?.user?.id);
    logger.info(
      "[EchoFlow] app_metadata:",
      JSON.stringify(session?.user?.app_metadata),
    );
    logger.info(
      "[EchoFlow] is_pro:",
      session?.user?.app_metadata?.is_pro ?? "MISSING",
    );
    logger.info("[EchoFlow] Selected Language:", state.selectedLang);

    if (!audioUri) return;

    // Enforce Plan Limits for Audio Duration
    if (durationMs > permissions.dictationDurationMs) {
      const limitSec = permissions.dictationDurationMs / 1000;
      dispatch({
        type: "SET_ERROR",
        payload: `Audio exceeds your plan limit (${limitSec}s). Please upgrade to Pro for longer files.`,
      });
      dispatch({ type: "SET_STEP", payload: "Error" });
      return;
    }

    triggerHaptic("selection");
    dispatch({ type: "SET_STEP", payload: "Transcribing" });
    dispatch({ type: "SET_UPLOAD_PROGRESS", payload: 0 });
    lastUploadPctRef.current = -1;
    lastTranscribeArgsRef.current = { durationSeconds, waveform };
    lastOpRef.current = "transcribe";

    const controller = new AbortController();
    processingAbortRef.current = controller;

    const isOnline = await checkIsOnline();
    if (!isOnline) {
      dispatch({
        type: "SET_ERROR",
        payload: "Transcription requires an active internet connection.",
      });
      dispatch({ type: "SET_STEP", payload: "Error" });
      dispatch({ type: "SET_UPLOAD_PROGRESS", payload: null });
      return;
    }

    try {
      activateKeepAwakeAsync("echoSession").catch(() => {});
      // Audio is already decoded and pre-warmed during the Intent Resolution phase
      const safeUri = audioUri;

      // Transcription Mutation
      const trResult = await batchTranscriber.transcribe(
        {
          uri: safeUri,
          durationMs,
          meteringData: waveform,
          waveform: [],
        },
        state.selectedLang,
        controller.signal,
        (fraction) => {
          // Upload done → the worker pipeline is running server-side; switch
          // to the indeterminate phase so the bar doesn't sit at 100%.
          if (fraction >= 1) {
            lastUploadPctRef.current = -1;
            dispatch({ type: "SET_UPLOAD_PROGRESS", payload: null });
            return;
          }
          // Throttle to whole-percent changes to limit re-renders.
          const pct = Math.round(fraction * 100);
          if (pct !== lastUploadPctRef.current) {
            lastUploadPctRef.current = pct;
            dispatch({ type: "SET_UPLOAD_PROGRESS", payload: fraction });
          }
        },
      );

      if (controller.signal.aborted) {
        // User cancelled → back to the config step, no error.
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "Preview" });
        return;
      }

      if (!trResult.ok) {
        throw new Error(trResult.error);
      }

      const detectedLang = resolveDetectedLanguage(
        trResult.value.detectedLang,
        state.selectedLang,
        "en",
      );

      dispatch({ type: "SET_DETECTED_LANG", payload: detectedLang });

      dispatch({
        type: "SET_TRANSCRIPTION",
        payload: {
          text: trResult.value.transcript,
          provider: trResult.value.provider,
        },
      });

      lastOpRef.current = null;
      triggerHaptic(Haptics.NotificationFeedbackType.Success);
      dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "Preview" });
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error("[EchoFlow] Transcription Error:", message);
      dispatch({ type: "SET_ERROR", payload: message });
      dispatch({ type: "SET_STEP", payload: "Error" });
    } finally {
      processingAbortRef.current = null;
      dispatch({ type: "SET_UPLOAD_PROGRESS", payload: null });
      deactivateKeepAwake("echoSession").catch(() => {});
    }
  };

  // Translation Logic
  const handleTranslate = async (): Promise<void> => {
    const textToTranslate = state.transcription;
    const source = state.detectedLang;
    const target = state.targetLang;
    const stt = state.sttProvider;

    logger.info("[EchoFlow] ── Initiating Translation ──");
    logger.info("[EchoFlow] Source:", source, "→ Target:", target);

    if (!textToTranslate || !source) return;

    triggerHaptic("selection");
    // Clear old translation immediately to prevent "brief text flash"
    dispatch({ type: "SET_TRANSLATION", payload: { text: null } });
    dispatch({ type: "SET_STEP", payload: "Translating" });
    lastOpRef.current = "translate";

    const controller = new AbortController();
    processingAbortRef.current = controller;

    const isOnline = await checkIsOnline();
    if (!isOnline) {
      dispatch({
        type: "SET_ERROR",
        payload: "Translation requires an active internet connection.",
      });
      dispatch({ type: "SET_STEP", payload: "Error" });
      return;
    }

    let translationResultText = null;

    try {
      activateKeepAwakeAsync("echoSession").catch(() => {});
      const trResult = await translate(
        textToTranslate,
        source,
        target,
        controller.signal,
      );

      if (controller.signal.aborted) {
        // User cancelled → back to the transcript, no error.
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
        return;
      }

      if (!trResult.ok) {
        throw new Error(trResult.error);
      }

      translationResultText = trResult.value.translation;
      dispatch({
        type: "SET_TRANSLATION",
        payload: {
          text: translationResultText,
          provider: trResult.value.provider,
        },
      });

      if (autoCopy && translationResultText) {
        await Clipboard.setStringAsync(translationResultText);
        setAutoCopied(true);
        if (autoCopyTimerRef.current) clearTimeout(autoCopyTimerRef.current);
        autoCopyTimerRef.current = setTimeout(() => setAutoCopied(false), 2000);
      }
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
        return;
      }
      const message = e instanceof Error ? e.message : "Unknown error";
      logger.error("Translate Error:", message);
      dispatch({ type: "SET_ERROR", payload: message });
      dispatch({ type: "SET_STEP", payload: "Error" });
      return; // Stop flow on translation error
    } finally {
      processingAbortRef.current = null;
      deactivateKeepAwake("echoSession").catch(() => {});
    }

    // Record to history safely: single "both" write (Full Transaction)
    lastOpRef.current = null;
    savedRef.current = true;
    await HistoryService.recordTranslation(
      {
        sourceLang: source,
        targetLang: target,
        transcript: textToTranslate,
        translation: translationResultText,
        transliteration: null,
        duration: state.audioDuration,
        sourceApp,
        provider: stt || "unknown",
        sessionKey: audioUri || undefined,
      },
      session,
    );

    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    dispatch({ type: "SET_STEP", payload: "FullResult" });
  };

  // Cancels the in-flight transcribe/translate request. The operation handlers
  // observe `controller.signal.aborted` and return to their originating step.
  const cancelProcessing = useCallback((): void => {
    processingAbortRef.current?.abort();
  }, []);

  // Re-runs the operation that failed, keeping the user's language choices.
  // The Error step calls this instead of resetting to the language picker.
  const retryOperation = async (): Promise<void> => {
    if (lastOpRef.current === "translate") {
      await handleTranslate();
    } else if (lastTranscribeArgsRef.current) {
      await handleTranscribe(
        lastTranscribeArgsRef.current.durationSeconds,
        lastTranscribeArgsRef.current.waveform,
      );
    }
  };

  const onDismiss = useCallback((): void => {
    // If not saved, save as transcription-only (Half Transaction)
    if (!savedRef.current && transcriptRef.current?.trim()) {
      savedRef.current = true;
      HistoryService.recordTranslation(
        {
          sourceLang: detectedLangRef.current || "en",
          targetLang:
            targetLangRef.current || settings$.targetLanguage.get() || "en",
          transcript: transcriptRef.current,
          translation: null,
          transliteration: null,
          duration: durationRef.current,
          sourceApp,
          provider: sttRef.current || "unknown",
          sessionKey: audioUri || undefined,
        },
        session,
      ).catch((e) =>
        logger.error("Failed to save transcription-only on overlay dismiss", e),
      );
    }

    // Release the native player BEFORE the cache files it may still reference
    // are deleted, so a backgrounded app never tries to play a removed file.
    onPlayerRelease?.();
    if (activeResolvedUri.current) cleanEchoCache(activeResolvedUri.current);
    if (audioUri && audioUri !== activeResolvedUri.current) {
      cleanEchoCache(audioUri);
    }
    deactivateKeepAwake("echoSession").catch(() => {});
    IntentService.dismissEcho();
  }, [sourceApp, session, audioUri, activeResolvedUri, onPlayerRelease]);

  // Clean up and dismiss if the user backgrounds the app
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      // "inactive" is transient (system dialogs, app switcher) — only dismiss
      // when the app is fully backgrounded to avoid killing the flow mid-step.
      if (nextAppState === "background") {
        logger.info("[EchoFlow] App state changed to background, dismissing echo...");
        onDismiss();
      }
    });

    return (): void => {
      subscription.remove();
    };
  }, [onDismiss]);

  return {
    step: state.step,
    setStep,
    selectedLang: state.selectedLang,
    setSelectedLang,
    detectedLang: state.detectedLang,
    targetLang: state.targetLang,
    setTargetLang,
    transcription: state.transcription,
    translation: state.translation,
    sttProvider: state.sttProvider,
    llmProvider: state.llmProvider,
    audioUri,
    sourceApp,
    isResolving,
    convertedWaveform,
    convertedDurationMs,
    handleTranscribe,
    handleTranslate,
    cancelProcessing,
    retryOperation,
    audioDuration: state.audioDuration,
    error: state.error,
    uploadProgress: state.uploadProgress,
    autoCopied,
    onDismiss,
  };
};
