import { useValue } from "@legendapp/state/react";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { triggerHaptic } from "@/utils/haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useCallback, useReducer, useRef, useState } from "react";
import { Linking } from "react-native";

import { useEchoAudioResolver } from "@/hooks/echo/useEchoAudioResolver";

import { useTranslation } from "@/hooks/useTranslation";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";

import { usePermissions } from "@/hooks/usePermissions";
import { CopyService } from "@/services/copyOutService";
import { batchTranscriber } from "@/services/batchTranscriber";
import { HistoryService } from "@/services/historyService";
import { IntentService } from "@/services/intentService";
import { settings$, auth$, network$ } from "@/store";
import { EchoStep, EchoProps, UseEchoFlowResult } from "@/types/echo";
import { default as logger, addSentryBreadcrumb } from "@/utils/logger";
import { cleanEchoCache } from "@/utils/audioCache";
import { ErrorMessages } from "@/constants/errors";
import {
  resolveDetectedLanguage,
  getDefaultSourceLang,
  isAutoDetectPermitted,
} from "@/utils/languageUtils";
import { checkIsOnline } from "@/utils/connectivity";
import { AppAlert } from "@/utils/alert";

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
  | { type: "FAIL"; payload: { error: string } }
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
    case "FAIL":
      return { ...state, error: action.payload.error, step: "Error" };
    case "RESET":
      return {
        ...state,
        step: "PickLanguage",
        transcription: null,
        translation: null,
        detectedLang: null,
        uploadProgress: null,
        error: null,
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
  const autoCopySetting = useValue(() => settings$.autoCopy.get());
  const autoCopy = permissions.autoCopy ? autoCopySetting : false;
  const session = useValue(() => auth$.session.get());
  /**
   * The app the audio was shared from, or null when the platform did not tell
   * us. Previously this fell back to the sentinel "ios", which then had to be
   * special-cased by every display path to avoid rendering a bare platform name
   * as if it were an app.
   */
  const sourceApp = props.sourceApp?.trim() ? props.sourceApp.trim() : null;

  /**
   * Identifies this capture so the transcription and any later translation land
   * on one row. Re-minted per share intent.
   */
  const captureIdRef = useRef<string | null>(null);
  const getCaptureId = useCallback((): string => {
    captureIdRef.current ??= Crypto.randomUUID();
    return captureIdRef.current;
  }, []);

  const netConnected = useValue(() => network$.isConnected.get());
  const netReachable = useValue(() => network$.isInternetReachable.get());
  const isOnline = netConnected !== false && netReachable !== false;

  const sourceAppLoggedRef = useRef(false);
  if (!sourceAppLoggedRef.current) {
    sourceAppLoggedRef.current = true;
    logger.info(
      "[EchoFlow] Raw sourceApp from native:",
      JSON.stringify(props.sourceApp),
    );
  }

  const [state, dispatch] = useReducer(echoReducer, {
    step: "PickLanguage",
    selectedLang: getDefaultSourceLang(isAutoDetectPermitted()),
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

  const [autoCopied, setAutoCopied] = useState(false);
  const autoCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return (): void => {
      if (autoCopyTimerRef.current) clearTimeout(autoCopyTimerRef.current);
    };
  }, []);

  const goneRef = useRef(false);
  const isGone = (): boolean => goneRef.current;
  useEffect(
    () => (): void => {
      goneRef.current = true;
    },
    [],
  );

  const savedRef = useRef(false);
  const transcriptRef = useRef(state.transcription);
  const detectedLangRef = useRef(state.detectedLang);
  const targetLangRef = useRef(state.targetLang);
  const sttRef = useRef(state.sttProvider);
  const durationRef = useRef(state.audioDuration);

  const processingAbortRef = useRef<AbortController | null>(null);

  const lastOpRef = useRef<"transcribe" | "translate" | "resolve" | null>(null);
  const lastTranscribeArgsRef = useRef<{
    durationSeconds: number;
    waveform: number[];
  } | null>(null);

  const lastUploadPctRef = useRef(-1);

  const lastTranscribeTimeRef = useRef<number>(0);

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

  const { translate } = useTranslation();

  const {
    audioUri,
    isResolving,
    convertedWaveform,
    convertedDurationMs,
    resolveError,
    resolveRetryable,
    retryResolve,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
  } = useEchoAudioResolver({
    ...props,
    maxDurationMs: permissions.dictationDurationMs,
  });

  useEffect(() => {
    if (resolveError && !isResolving) {
      lastOpRef.current = "resolve";
      dispatch({ type: "FAIL", payload: { error: resolveError } });
    }
  }, [resolveError, isResolving]);

  useEffect(() => {
    if (!isSubsequentIntent) return;
    if (!savedRef.current && transcriptRef.current?.trim()) {
      savedRef.current = true;
      HistoryService.recordTranslation(
        {
          captureId: getCaptureId(),
          origin: "echo",
          input: "audio",
          sourceLang:
            detectedLangRef.current ||
            getDefaultSourceLang(isAutoDetectPermitted()),
          targetLang:
            targetLangRef.current || settings$.targetLanguage.get() || "en",
          transcript: transcriptRef.current,
          translation: null,
          transliteration: null,
          duration: durationRef.current,
          sourceApp,
          voiceId: null,
          sttProvider: sttRef.current || "unknown",
          mtProvider: null,
          type: "transcription",
        },
        session,
      ).catch((e) =>
        logger.error(
          "[EchoFlow] Failed to save transcription-only on new intent",
          e,
        ),
      );
    }
    savedRef.current = false;
    transcriptRef.current = null;
    detectedLangRef.current = null;
    // A new share intent is a new capture.
    captureIdRef.current = null;
    dispatch({ type: "RESET" });
    setIsSubsequentIntent(false);
  }, [
    isSubsequentIntent,
    setIsSubsequentIntent,
    sourceApp,
    session,
    getCaptureId,
  ]);

  const onDismiss = useCallback((): void => {
    if (!savedRef.current && transcriptRef.current?.trim()) {
      savedRef.current = true;
      HistoryService.recordTranslation(
        {
          captureId: getCaptureId(),
          origin: "echo",
          input: "audio",
          sourceLang:
            detectedLangRef.current ||
            getDefaultSourceLang(isAutoDetectPermitted()),
          targetLang:
            targetLangRef.current || settings$.targetLanguage.get() || "en",
          transcript: transcriptRef.current,
          translation: null,
          transliteration: null,
          duration: durationRef.current,
          sourceApp,
          voiceId: null,
          sttProvider: sttRef.current || "unknown",
          mtProvider: null,
          type: "transcription",
        },
        session,
      ).catch((e) =>
        logger.error("Failed to save transcription-only on overlay dismiss", e),
      );
    }

    goneRef.current = true;
    processingAbortRef.current?.abort();

    onPlayerRelease?.();
    if (activeResolvedUri.current) cleanEchoCache(activeResolvedUri.current);
    if (audioUri && audioUri !== activeResolvedUri.current) {
      cleanEchoCache(audioUri);
    }
    deactivateKeepAwake("echoSession").catch(() => {});
    IntentService.dismissEcho();
  }, [
    sourceApp,
    session,
    audioUri,
    activeResolvedUri,
    onPlayerRelease,
    getCaptureId,
  ]);

  const handleTranscribe = useCallback(
    async (durationSeconds: number, waveform: number[]): Promise<void> => {
      if (isGone()) return;

      if (!session) {
        logger.info(
          "[EchoFlow] No session found during transcribe. Prompting login.",
        );
        AppAlert.info(
          "Login Required",
          "Please log in to translate your shared files.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Log In",
              style: "default",
              onPress: (): void => {
                Linking.openURL("ekwe://login").catch((err) => {
                  logger.error(
                    "[EchoFlow] Failed to open login deep link:",
                    err,
                  );
                });
                onDismiss();
              },
            },
          ],
        );
        return;
      }

      lastTranscribeArgsRef.current = { durationSeconds, waveform };
      lastOpRef.current = "transcribe";

      const now = Date.now();
      const elapsedSeconds = (now - lastTranscribeTimeRef.current) / 1000;
      if (elapsedSeconds < permissions.cooldownSeconds) {
        const waitTime = Math.ceil(
          permissions.cooldownSeconds - elapsedSeconds,
        );
        dispatch({
          type: "FAIL",
          payload: {
            error: `Please wait ${waitTime}s before transcribing again.`,
          },
        });
        return;
      }

      const durationMs =
        convertedDurationMs ?? Math.round(durationSeconds * 1000);
      dispatch({ type: "SET_AUDIO_DURATION", payload: durationMs / 1000 });
      logger.info(
        `[EchoFlow] Initiating transcription (lang: ${state.selectedLang})`,
      );

      if (!audioUri) return;

      if (durationMs > permissions.dictationDurationMs) {
        const limitSec = permissions.dictationDurationMs / 1000;
        dispatch({
          type: "FAIL",
          payload: {
            error: `Audio exceeds your plan limit (${limitSec}s). Please upgrade to Pro for longer files.`,
          },
        });
        return;
      }

      let online = false;
      try {
        online = await checkIsOnline();
      } catch (e: unknown) {
        logger.error(
          "[EchoFlow] Connectivity check failed:",
          e instanceof Error ? (e.stack ?? e.message) : String(e),
        );
      }
      if (!online) {
        dispatch({
          type: "FAIL",
          payload: {
            error: "Transcription requires an active internet connection.",
          },
        });
        return;
      }

      const controller = new AbortController();
      processingAbortRef.current = controller;

      lastTranscribeTimeRef.current = Date.now();

      triggerHaptic("selection");
      dispatch({ type: "SET_STEP", payload: "Transcribing" });
      dispatch({ type: "SET_UPLOAD_PROGRESS", payload: 0 });
      lastUploadPctRef.current = -1;

      try {
        activateKeepAwakeAsync("echoSession").catch(() => {});
        const safeUri = audioUri;

        const trResult = await batchTranscriber.transcribe(
          {
            uri: safeUri,
            durationMs,
            meteringData: waveform,
            waveform,
          },
          state.selectedLang,
          controller.signal,
          (fraction) => {
            if (fraction >= 1) {
              lastUploadPctRef.current = -1;
              dispatch({ type: "SET_UPLOAD_PROGRESS", payload: null });
              return;
            }
            const pct = Math.round(fraction * 100);
            if (pct !== lastUploadPctRef.current) {
              lastUploadPctRef.current = pct;
              dispatch({ type: "SET_UPLOAD_PROGRESS", payload: fraction });
            }
          },
        );

        if (isGone()) return;

        if (controller.signal.aborted) {
          dispatch({ type: "SET_ERROR", payload: null });
          dispatch({ type: "SET_STEP", payload: "Preview" });
          return;
        }

        if (!trResult.ok) {
          // A rate limit is an expected outcome the UI already surfaces, so it
          // must not be captured as an error. `logger.warn` compiles out of
          // release builds, so the breadcrumb keeps it measurable in production.
          addSentryBreadcrumb("echo.transcribe", "rejected", {
            reason: trResult.error,
          });
          logger.warn("[EchoFlow] Transcribe rejected:", trResult.error);
          dispatch({
            type: "FAIL",
            payload: {
              error: ErrorMessages[trResult.error] ?? trResult.error,
            },
          });
          return;
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
        invalidateUsage();
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          dispatch({ type: "SET_ERROR", payload: null });
          dispatch({ type: "SET_STEP", payload: "Preview" });
          return;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error(
          "[EchoFlow] Transcription Error:",
          message,
          err instanceof Error ? (err.stack ?? message) : String(err),
        );
        dispatch({ type: "FAIL", payload: { error: message } });
      } finally {
        processingAbortRef.current = null;
        dispatch({ type: "SET_UPLOAD_PROGRESS", payload: null });
        deactivateKeepAwake("echoSession").catch(() => {});
      }
    },
    [
      session,
      permissions.cooldownSeconds,
      permissions.dictationDurationMs,
      audioUri,
      convertedDurationMs,
      state.selectedLang,
      onDismiss,
    ],
  );

  const handleTranslate = useCallback(async (): Promise<void> => {
    if (isGone()) return;

    const textToTranslate = state.transcription;
    const source = state.detectedLang;
    const target = state.targetLang;
    const stt = state.sttProvider;

    if (!textToTranslate) return;

    const sourceLang =
      source ?? (state.selectedLang !== "auto" ? state.selectedLang : null);
    if (!sourceLang) {
      logger.error("[EchoFlow] No source language for translation");
      dispatch({
        type: "FAIL",
        payload: {
          error:
            "Couldn't detect the language of this voice note. Try again or pick a language manually.",
        },
      });
      return;
    }

    logger.info(`[EchoFlow] Translating ${sourceLang} → ${target}`);

    lastOpRef.current = "translate";

    const isOnline = await checkIsOnline();
    if (!isOnline) {
      dispatch({
        type: "FAIL",
        payload: {
          error: "Translation requires an active internet connection.",
        },
      });
      return;
    }

    const controller = new AbortController();
    processingAbortRef.current = controller;

    triggerHaptic("selection");
    dispatch({ type: "SET_TRANSLATION", payload: { text: null } });
    dispatch({ type: "SET_STEP", payload: "Translating" });

    let translationResultText: string | null = null;
    let transliterationText: string | null = null;
    let mtProvider: string | null = null;
    let succeeded = false;

    try {
      activateKeepAwakeAsync("echoSession").catch(() => {});
      const trResult = await translate(
        textToTranslate,
        sourceLang,
        target,
        controller.signal,
      );

      if (isGone()) return;

      if (controller.signal.aborted) {
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
        return;
      }

      if (!trResult.ok) {
        logger.warn("Translate Error:", trResult.error);
        dispatch({
          type: "FAIL",
          payload: { error: ErrorMessages[trResult.error] ?? trResult.error },
        });
        return;
      }

      translationResultText = trResult.value.translation;
      // Both of these came back with the translation and used to be discarded.
      // Transliteration is what makes non-Latin scripts readable, and the MT
      // provider is a different model from the STT one that heard the audio.
      transliterationText = trResult.value.transliteration ?? null;
      mtProvider = trResult.value.provider || null;
      succeeded = true;
      dispatch({
        type: "SET_TRANSLATION",
        payload: {
          text: translationResultText,
          provider: trResult.value.provider,
        },
      });

      if (autoCopy && translationResultText) {
        // CopyService owns the signature; do not append it here.
        if (await CopyService.copyText(translationResultText)) {
          setAutoCopied(true);
          if (autoCopyTimerRef.current) clearTimeout(autoCopyTimerRef.current);
          autoCopyTimerRef.current = setTimeout(
            () => setAutoCopied(false),
            2000,
          );
        }
      }
    } catch (e: unknown) {
      if (isGone()) return;
      if (controller.signal.aborted) {
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
        return;
      }
      const message = e instanceof Error ? e.message : "Unknown error";
      logger.warn("Translate Error:", message);
      dispatch({ type: "FAIL", payload: { error: message } });
      return;
    } finally {
      processingAbortRef.current = null;
      deactivateKeepAwake("echoSession").catch(() => {});
    }

    if (isGone() || !succeeded) return;

    lastOpRef.current = null;
    savedRef.current = true;
    try {
      // One write, not two. Transcription does not write history on its own —
      // the note is only archived once the user commits to keeping it — so
      // there is no earlier row for this to update. The transcription-only
      // paths above (dismiss, next intent) cover the case where the user never
      // gets this far.
      await HistoryService.recordTranslation(
        {
          captureId: getCaptureId(),
          origin: "echo",
          input: "audio",
          sourceLang: sourceLang,
          targetLang: target,
          transcript: textToTranslate,
          translation: translationResultText,
          transliteration: transliterationText,
          // Seconds of the source audio, not of anything we generated.
          duration: state.audioDuration,
          sourceApp,
          voiceId: null,
          sttProvider: stt || "unknown",
          mtProvider,
          type: "translation",
        },
        session,
      );
    } catch (e) {
      logger.warn("[EchoFlow] Failed to record history:", e);
    }

    if (isGone()) return;

    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    dispatch({ type: "SET_STEP", payload: "FullResult" });
  }, [
    state.transcription,
    state.detectedLang,
    state.selectedLang,
    state.targetLang,
    state.sttProvider,
    state.audioDuration,
    autoCopy,
    sourceApp,
    translate,
    session,
    getCaptureId,
  ]);

  const cancelProcessing = useCallback((): void => {
    processingAbortRef.current?.abort();
  }, []);

  const retryOperation = useCallback(async (): Promise<void> => {
    if (lastOpRef.current === "translate") {
      await handleTranslate();
    } else if (lastOpRef.current === "resolve") {
      if (!resolveRetryable) return;
      retryResolve();
      setStep("PickLanguage");
    } else if (lastTranscribeArgsRef.current) {
      await handleTranscribe(
        lastTranscribeArgsRef.current.durationSeconds,
        lastTranscribeArgsRef.current.waveform,
      );
    }
  }, [
    handleTranslate,
    handleTranscribe,
    retryResolve,
    setStep,
    resolveRetryable,
  ]);

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
    resolveRetryable,
    audioDuration: state.audioDuration,
    error: state.error,
    uploadProgress: state.uploadProgress,
    autoCopied,
    onDismiss,
    autoLanguageDetect: permissions.autoLanguageDetect,
    isOnline,
  };
};
