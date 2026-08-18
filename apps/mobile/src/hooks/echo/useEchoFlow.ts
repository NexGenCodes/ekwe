import { useSelector } from "@legendapp/state/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { triggerHaptic } from "@/utils/haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useCallback, useReducer, useRef, useState } from "react";
import { AppState, Linking } from "react-native";

import { useEchoAudioResolver } from "./useEchoAudioResolver";

import { useTranslation } from "../useTranslation";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";

import { usePermissions } from "@/hooks/usePermissions";
import { batchTranscriber } from "@/services/BatchTranscriber";
import { HistoryService } from "@/services/HistoryService";
import { IntentService } from "@/services/IntentService";
import { settings$, auth$, network$ } from "@/store";
import { EchoStep, EchoProps, UseEchoFlowResult } from "@/types/echo";
import { default as logger } from "@/utils/logger";
import { isIOS } from "@/utils/platform";
import { cleanEchoCache } from "@/utils/echo";
import { ECHO_SHARE_SIGNATURE } from "@/constants/echo";
import {
  resolveDetectedLanguage,
  getDefaultSourceLang,
} from "@/utils/languageUtils";
import { checkIsOnline } from "@/utils/netInfo";
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

  // Reactive connectivity (single source of truth from the network store).
  // Only a *definitive* disconnect counts as offline — `null` probes never do.
  const netConnected = useSelector(() => network$.isConnected.get());
  const netReachable = useSelector(() => network$.isInternetReachable.get());
  const isOnline = netConnected !== false && netReachable !== false;

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

  // Marks the flow as torn down (dismissed or unmounted). Once set, the async
  // transcribe/translate handlers MUST stop side-effecting (dispatching state,
  // writing history) so a late completion never double-records, sets state on an
  // unmounted tree, or resurrects the sheet after it was closed.
  const goneRef = useRef(false);
  const isGone = (): boolean => goneRef.current;
  useEffect(
    () => (): void => {
      goneRef.current = true;
    },
    [],
  );

  // Entry state refs
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
  const lastOpRef = useRef<"transcribe" | "translate" | "resolve" | null>(null);
  const lastTranscribeArgsRef = useRef<{
    durationSeconds: number;
    waveform: number[];
  } | null>(null);

  // Throttles upload-progress dispatches to whole-percent changes so the
  // sheet doesn't re-render on every native progress event.
  const lastUploadPctRef = useRef(-1);

  // Rate-limiting: prevents rapid-fire transcription requests.
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
    resolveError,
    resolveRetryable,
    retryResolve,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
  } = useEchoAudioResolver(props);

  // Surface audio-resolution failures (unreadable / too-large / decode error)
  // into the Error step so the user isn't left stuck on "Loading Audio…".
  useEffect(() => {
    if (resolveError && !isResolving) {
      lastOpRef.current = "resolve";
      dispatch({ type: "FAIL", payload: { error: resolveError } });
    }
  }, [resolveError, isResolving]);

  // Reset state on subsequent share intents
  useEffect(() => {
    if (!isSubsequentIntent) return;
    // An unpersisted transcription would be lost on reset; save it here before
    // the flow resets — the same transcription-only semantics as onDismiss.
    // When savedRef is already true, everything was persisted and the reset is
    // safe.
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
    // Clear the transcript refs synchronously — the ref-sync effect at the top
    // of the hook runs post-render. A dismiss landing in the gap between this
    // reset and the next render would otherwise see savedRef=false with a stale
    // transcriptRef and re-save the OLD transcript under the new intent.
    transcriptRef.current = null;
    detectedLangRef.current = null;
    dispatch({ type: "RESET" });
    setIsSubsequentIntent(false);
  }, [isSubsequentIntent, setIsSubsequentIntent, sourceApp, session, audioUri]);

  // Tear down and dismiss. Hoisted above the transcribe/translate handlers so
  // they can safely reference it (e.g. the login prompt calls onDismiss).
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
          type: "transcription",
        },
        session,
      ).catch((e) =>
        logger.error("Failed to save transcription-only on overlay dismiss", e),
      );
    }

    // Tear down the flow: stop any in-flight request and freeze all async
    // handlers so a late completion never dispatches/saves after dismissal.
    goneRef.current = true;
    processingAbortRef.current?.abort();

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

  // Transcription Logic
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

      // Remember the operation + inputs up-front (BEFORE the cooldown and
      // plan-limit guards) so "Try Again" works regardless of which guard
      // rejected the request — cooldown, plan limit, offline, or server.
      lastTranscribeArgsRef.current = { durationSeconds, waveform };
      lastOpRef.current = "transcribe";

      // Enforce Cooldown Limit (Throttling)
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

      // Prefer the native duration reported during content resolution; fall
      // back to the player-derived estimate when unavailable.
      const durationMs =
        convertedDurationMs ?? Math.round(durationSeconds * 1000);
      dispatch({ type: "SET_AUDIO_DURATION", payload: durationMs / 1000 });
      logger.info(
        "[EchoFlow] Initiating transcription (lang: %s)",
        state.selectedLang,
      );

      if (!audioUri) return;

      // Enforce Plan Limits for Audio Duration
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

      const controller = new AbortController();
      processingAbortRef.current = controller;

      const isOnline = await checkIsOnline();
      if (!isOnline) {
        dispatch({
          type: "FAIL",
          payload: {
            error: "Transcription requires an active internet connection.",
          },
        });
        return;
      }

      // A request is now actually being submitted — only now stamp the throttle so
      // validation/cancel/offline rejections don't consume the user's cooldown.
      lastTranscribeTimeRef.current = Date.now();

      triggerHaptic("selection");
      dispatch({ type: "SET_STEP", payload: "Transcribing" });
      dispatch({ type: "SET_UPLOAD_PROGRESS", payload: 0 });
      lastUploadPctRef.current = -1;

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

        if (isGone()) return;

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
        invalidateUsage();
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          dispatch({ type: "SET_ERROR", payload: null });
          dispatch({ type: "SET_STEP", payload: "Preview" });
          return;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("[EchoFlow] Transcription Error:", message);
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

  // Translation Logic. The user-facing result is applied BEFORE persisting, and
  // the history write is error-safe so a sync failure never strands the user on
  // the Translating sheet or keeps FullResult from rendering.
  const handleTranslate = useCallback(async (): Promise<void> => {
    if (isGone()) return;

    const textToTranslate = state.transcription;
    const source = state.detectedLang;
    const target = state.targetLang;
    const stt = state.sttProvider;

    if (!textToTranslate) return;

    // The detected language is the source. When auto-detect came back empty
    // (provider didn't report one AND the worker fallback didn't run), fall
    // back to a concrete user selection before giving up — an explicit
    // "English" source is still translatable even without a detection.
    const sourceLang = source ?? (state.selectedLang !== "auto" ? state.selectedLang : null);
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

    logger.info("[EchoFlow] Translating %s → %s", sourceLang, target);

    // Set up-front so an offline rejection still lands on a retryable Error step.
    lastOpRef.current = "translate";

    const controller = new AbortController();
    processingAbortRef.current = controller;

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

    triggerHaptic("selection");
    // Clear old translation immediately to prevent "brief text flash"
    dispatch({ type: "SET_TRANSLATION", payload: { text: null } });
    dispatch({ type: "SET_STEP", payload: "Translating" });

    let translationResultText: string | null = null;
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
        // User cancelled → back to the transcript, no error.
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
        return;
      }

      if (!trResult.ok) {
        throw new Error(trResult.error);
      }

      translationResultText = trResult.value.translation;
      succeeded = true;
      dispatch({
        type: "SET_TRANSLATION",
        payload: {
          text: translationResultText,
          provider: trResult.value.provider,
        },
      });

      // Auto-copy carries the same brand signature the manual copy appends, so
      // a pasted result always points back to Ekwe regardless of how it was
      // copied.
      if (autoCopy && translationResultText) {
        await Clipboard.setStringAsync(
          `${translationResultText}${ECHO_SHARE_SIGNATURE}`,
        );
        setAutoCopied(true);
        if (autoCopyTimerRef.current) clearTimeout(autoCopyTimerRef.current);
        autoCopyTimerRef.current = setTimeout(() => setAutoCopied(false), 2000);
      }
    } catch (e: unknown) {
      if (isGone()) return;
      if (controller.signal.aborted) {
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_STEP", payload: "TranscribeResult" });
        return;
      }
      const message = e instanceof Error ? e.message : "Unknown error";
      logger.error("Translate Error:", message);
      dispatch({ type: "FAIL", payload: { error: message } });
      return; // Stop flow on translation error
    } finally {
      processingAbortRef.current = null;
      deactivateKeepAwake("echoSession").catch(() => {});
    }

    // If the flow was dismissed mid-translate (backgrounded / closed) or the
    // call failed, do NOT write history — onDismiss already recorded a
    // transcription-only row, and an error row would be misleading.
    if (isGone() || !succeeded) return;

    // Record to history safely: the transcription and its translation become
    // TWO separate entries — the transcription keeps the audio metadata, the
    // translation is a plain text → text row. A history-sync rejection must
    // never prevent reaching FullResult.
    lastOpRef.current = null;
    savedRef.current = true;
    try {
      await HistoryService.recordTranslation(
        {
          sourceLang: sourceLang,
          targetLang: target,
          transcript: textToTranslate,
          translation: null,
          transliteration: null,
          duration: state.audioDuration,
          sourceApp,
          provider: stt || "unknown",
          sessionKey: audioUri || undefined,
          type: "transcription",
        },
        session,
      );
      await HistoryService.recordTranslation(
        {
          sourceLang: sourceLang,
          targetLang: target,
          transcript: textToTranslate,
          translation: translationResultText,
          transliteration: null,
          duration: 0,
          sourceApp,
          provider: stt || "unknown",
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
    audioUri,
    sourceApp,
    translate,
    session,
  ]);

  // Cancels the in-flight transcribe/translate request. The operation handlers
  // observe `controller.signal.aborted` and return to their originating step.
  const cancelProcessing = useCallback((): void => {
    processingAbortRef.current?.abort();
  }, []);

  // Re-runs the operation that failed, keeping the user's language choices.
  // The Error step calls this instead of resetting to the language picker.
  const retryOperation = useCallback(async (): Promise<void> => {
    if (lastOpRef.current === "translate") {
      await handleTranslate();
    } else if (lastOpRef.current === "resolve") {
      // Terminal file conditions (e.g. FILE_TOO_LARGE) can never succeed on a
      // retry, so stay put instead of burning a resolve cycle on the same file.
      if (!resolveRetryable) return;
      // Re-attempt audio resolution, then return to the language picker (the
      // flow's initial step) so the user can proceed once it loads.
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

  // Clean up and dismiss if the user backgrounds the app
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      // "inactive" is transient (system dialogs, app switcher) — only dismiss
      // when the app is fully backgrounded to avoid killing the flow mid-step.
      if (nextAppState === "background") {
        logger.info(
          "[EchoFlow] App state changed to background, dismissing echo...",
        );
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
