import { useValue } from "@legendapp/state/react";
import { type VoiceGender } from "@ekwe/shared";
import * as Crypto from "expo-crypto";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { BackHandler, Keyboard } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";

import { ExpressiveInput } from "@/components/home/ExpressiveInput";
import type { EditableField } from "@/components/home/EditableText";
import { planEdit } from "@/components/home/editPlan";
import { VoicePickerSheet } from "@/components/home/VoicePickerSheet";
import { VoiceResultPanel } from "@/components/home/VoiceResultPanel";

import { Box } from "@/components/ui";
import { EkweError, ErrorMessages } from "@/constants/errors";
import { getLanguageName } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import { usePermissions, useVoiceDictation } from "@/hooks";
import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { useVoicePreview } from "@/hooks/audio/useVoicePreview";
import { HistoryService } from "@/services/historyService";
import { ShareOutService } from "@/services/shareOutService";
import { synthesizeAudio, synthesizeSpeech } from "@/services/speech";
import { startSpan } from "@/utils/perfSpan";
import { auth$, settings$, settingsActions } from "@/store";
import { triggerHaptic } from "@/utils";
import { cleanAudioArtifacts } from "@/utils/audioCache";
import { useSessionAudioFiles } from "@/utils/sessionAudioFiles";
import {
  DEFAULT_LANGUAGES,
  sanitizeLanguageCodes,
} from "@/utils/languageUtils";
import { normalizeAmplitudes } from "@/utils/waveform";
import { resolveVoiceSelection, type VoiceSelection } from "@/utils/voices";
import { AppToast } from "@/utils/toast";
import { AppAlert } from "@/utils/alert";

import logger from "@/utils/logger";

export interface VoiceStudioInterfaceProps {
  onInputFocusChange?: (focused: boolean) => void;
}

export interface VoiceStudioInterfaceRef {
  clear: () => Promise<void>;
}

/**
 * `editing` is a mode of the result, not a step: the result card is showing
 * the artifact and the user is correcting the words it will be sent as. There
 * is no position to indicate, so no stepper — the card itself changes.
 */
type Stage = "composer" | "converting" | "editing" | "ready";

/**
 * Long enough to collapse a browse across several cards, short enough that a
 * deliberate single tap still feels immediate.
 */
const CONVERT_DEBOUNCE_MS = 700;

/**
 * Floor between two re-renders of the same input.
 *
 * Distinct from `CONVERT_DEBOUNCE_MS`, which collapses a burst of *taps* into
 * one conversion. This one limits *rendered output*: a user who dislikes a
 * voice and taps Regenerate the moment it lands would otherwise spend a quota
 * per attempt.
 *
 * Applied only to re-renders, never to a first conversion. The first render is
 * already debounced, and a fresh input — a new recording, new text, or a
 * different voice — is a new intent, not a repeat, so gating it would block
 * the legitimate "didn't like that voice, try another" loop.
 */
const RENDER_COOLDOWN_MS = 2500;

interface CommittedRecording {
  uri: string;
  durationMs: number;
  waveform: number[];
}

function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 2.6));
}

export const VoiceStudioInterface = forwardRef<
  VoiceStudioInterfaceRef,
  VoiceStudioInterfaceProps
>(({ onInputFocusChange }, ref): React.ReactElement => {
  const permissions = usePermissions();

  const selectedLanguages =
    useValue(() => settings$.selectedLanguages.get()) ?? [];
  const defaultTargetLang = useValue(() => settings$.targetLanguage.get());
  const voiceId = useValue(() => settings$.voiceId.get());
  const voiceGender = useValue(() => settings$.voiceGender.get());

  const knownLanguages = sanitizeLanguageCodes(
    selectedLanguages.length > 0 ? selectedLanguages : DEFAULT_LANGUAGES,
    permissions.maxSelectedLanguages,
  );
  // Independently defaulting these let the two disagree: source was pinned to
  // the first selected language while target could be anything, so the worker
  // was asked to translate from a language the user never chose. Source is now
  // always a real selection, and target is always a different one.
  const initialSourceLang = permissions.autoLanguageDetect
    ? "auto"
    : (knownLanguages[0] ?? "en");
  const initialTargetLang = ((): string => {
    if (defaultTargetLang && defaultTargetLang !== initialSourceLang) {
      return defaultTargetLang;
    }
    return knownLanguages.find((code) => code !== initialSourceLang) ?? "en";
  })();

  const [sourceLang, setSourceLang] = useState(initialSourceLang);
  const [targetLang, setTargetLang] = useState(initialTargetLang);
  const [sourceText, setSourceText] = useState("");

  const [stage, setStage] = useState<Stage>("composer");
  const [sourceAudio, setSourceAudio] = useState<CommittedRecording | null>(
    null,
  );
  const [transcript, setTranscript] = useState("");
  /**
   * The translation the current audio was rendered from, or null when no
   * target language was chosen. This is the text the result presents as the
   * artifact, and the only field the result lets you edit.
   */
  const [translation, setTranslation] = useState<string | null>(null);
  /** The open editor's working copies, keyed by document. Null when closed. */
  const [editDraft, setEditDraft] = useState<{
    transcript: string;
    translation: string;
  } | null>(null);
  /** What was last archived for this capture, so edits can be compared. */
  const [artifactUri, setArtifactUri] = useState<string | null>(null);
  const [artifactDurationMs, setArtifactDurationMs] = useState(0);
  const [amplitudes, setAmplitudes] = useState<number[] | undefined>(undefined);

  const [isPickerVisible, setIsPickerVisible] = useState(false);

  const voice = useMemo(
    () => resolveVoiceSelection(voiceId, voiceGender),
    [voiceId, voiceGender],
  );

  const dictatingRef = useRef(false);
  const convertSeqRef = useRef(0);
  /**
   * Aborts the conversion in flight. Without a real signal a superseded
   * request still ran to completion on the worker and was billed for, even
   * though its result was discarded.
   */
  const convertAbortRef = useRef<AbortController | null>(null);
  /**
   * Defers the conversion a voice change triggers, so auditioning several
   * voices in a row costs one conversion instead of one per tap.
   */
  const convertDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledConvert = useCallback((): void => {
    if (convertDebounceRef.current) {
      clearTimeout(convertDebounceRef.current);
      convertDebounceRef.current = null;
    }
  }, []);
  useEffect(() => {
    return (): void => {
      cancelScheduledConvert();
      convertAbortRef.current?.abort();
    };
  }, [cancelScheduledConvert]);
  /**
   * Identifies the capture being converted, so regenerating with a different
   * voice updates the existing history row instead of appending a new one for
   * what is really the same utterance.
   *
   * Reset whenever the user supplies new input — otherwise "clear", then type
   * something different, would overwrite the previous note's history row
   * instead of adding a new one.
   */
  const captureIdRef = useRef<string | null>(null);
  const getCaptureId = useCallback((): string => {
    captureIdRef.current ??= Crypto.randomUUID();
    return captureIdRef.current;
  }, []);
  const resetCaptureId = useCallback((): void => {
    captureIdRef.current = null;
  }, []);

  // Mirrors of the draft text, so the archive-on-leave path can read the
  // current values without taking every state change as a dependency.
  const draftTranscriptRef = useRef("");
  const draftTranslationRef = useRef("");
  const resolvedSourceLangRef = useRef(sourceLang);
  const resolvedTargetLangRef = useRef(targetLang);

  const {
    status: dictationStatus,
    amplitude,
    elapsedMs,
    maxDurationMs,
    error: dictationError,
    capturedUri,
    capturedDurationMs,
    meteringData,
    interimText,
    finalText,
    isLive,
    startDictation,
    stopDictation,
    commitRecording,
    cancelDictation,
  } = useVoiceDictation();

  const player = useSharedAudioPlayer(artifactUri, artifactDurationMs || null);
  const sourcePlayer = useSharedAudioPlayer(
    sourceAudio?.uri ?? null,
    sourceAudio?.durationMs ?? null,
  );
  const isReturnAudioLoading =
    !!sourceAudio && (!sourcePlayer.isReady || sourcePlayer.isDecoding);

  const sourceSpeechLang = sourceLang === "auto" ? "en" : sourceLang;

  const files = useSessionAudioFiles();
  const handlePreviewError = useCallback((): void => {
    AppToast.error("Preview Unavailable", {
      description: "Failed to load voice preview.",
    });
  }, []);
  const preview = useVoicePreview({
    lang: sourceSpeechLang,
    files,
    onError: handlePreviewError,
  });

  const playerRef = useRef(player);
  const sourcePlayerRef = useRef(sourcePlayer);
  useEffect(() => {
    playerRef.current = player;
    sourcePlayerRef.current = sourcePlayer;
  });
  useEffect(() => {
    return (): void => {
      playerRef.current.pause();
      sourcePlayerRef.current.pause();
    };
  }, []);

  const rememberSessionFile = files.remember;
  const deleteSessionFile = files.deleteAfterDelay;
  const purgeSessionFiles = files.purge;

  const activeArtifactRef = useRef<string | null>(null);
  const commitArtifact = useCallback(
    (uri: string): void => {
      const previous = activeArtifactRef.current;
      activeArtifactRef.current = uri;
      rememberSessionFile(uri);
      if (previous && previous !== uri) deleteSessionFile(previous);
    },
    [rememberSessionFile, deleteSessionFile],
  );

  useEffect(() => {
    return (): void => {
      purgeSessionFiles();
    };
  }, [purgeSessionFiles]);

  useEffect(() => {
    if (dictationError) {
      AppAlert.error("Voice Input", dictationError);
    }
  }, [dictationError]);

  const handleClear = useCallback(async () => {
    await triggerHaptic();
    convertSeqRef.current += 1;
    cancelScheduledConvert();
    convertAbortRef.current?.abort();
    resetCaptureId();
    player.pause();
    sourcePlayer.pause();
    activeArtifactRef.current = null;
    setSourceText("");
    setTranscript("");
    setTranslation(null);
    setEditDraft(null);
    savedRef.current = false;
    draftTranscriptRef.current = "";
    draftTranslationRef.current = "";
    setSourceAudio(null);
    setArtifactUri(null);
    setArtifactDurationMs(0);
    setAmplitudes(undefined);
    preview.reset();
    setStage("composer");
    purgeSessionFiles();
  }, [
    cancelScheduledConvert,
    player,
    sourcePlayer,
    preview,
    purgeSessionFiles,
    resetCaptureId,
  ]);

  const handleDeleteAudio = useCallback(async () => {
    await triggerHaptic();
    const uri = sourceAudio?.uri ?? null;
    resetCaptureId();
    player.pause();
    sourcePlayer.pause();
    if (activeArtifactRef.current === uri) activeArtifactRef.current = null;
    setSourceAudio(null);
    setArtifactUri(null);
    setArtifactDurationMs(0);
    setAmplitudes(undefined);
    deleteSessionFile(uri);
  }, [player, sourcePlayer, sourceAudio, deleteSessionFile, resetCaptureId]);

  const handleCancelDictation = useCallback(() => {
    const uri = capturedUri;
    void cancelDictation();
    deleteSessionFile(uri);
  }, [capturedUri, cancelDictation, deleteSessionFile]);

  /**
   * Archive a Studio capture.
   *
   * The synthesized audio is deliberately not kept — it is a rendering of text
   * we already hold, and it is deleted when the session ends. What is worth
   * keeping is the text: what the user said or typed, and its translation if
   * one was produced. Both come back from the same `/synthesize` call that
   * generated the audio, so this costs no extra inference.
   */
  const recordStudioCapture = useCallback(
    (args: {
      captureId: string;
      input: "audio" | "text";
      transcript: string;
      translation: string | null;
      durationSeconds: number;
      resolvedSourceLang: string;
      /**
       * The language the speech was rendered in. This is the source language
       * when no translation was wanted, so it is never the "none" sentinel
       * the picker uses for "don't translate".
       */
      spokenLang: string;
    }): void => {
      const userSession = auth$.session.peek();
      if (!userSession) return;

      HistoryService.recordTranslation(
        {
          captureId: args.captureId,
          origin: "speech-studio",
          input: args.input,
          sourceLang: args.resolvedSourceLang,
          targetLang: args.spokenLang,
          transcript: args.transcript,
          translation: args.translation,
          transliteration: null,
          duration: args.durationSeconds,
          sourceApp: null,
          voiceId: voice.slot.id,
          sttProvider: args.input === "audio" ? "worker" : "",
          mtProvider: args.translation ? "worker" : null,
          type: args.translation ? "translation" : "transcription",
        },
        userSession,
      ).catch((e) =>
        logger.error("[VoiceStudio] Failed to archive capture", e),
      );
    },
    [voice.slot.id],
  );

  /**
   * Archive whatever text we hold, once per capture.
   *
   * `runConvert` writes as soon as a full `/synthesize` round trip lands, but
   * the user can now leave from a non-terminal step — or never render speech at
   * all — and the words they produced are the part worth keeping. Without this
   * the text would exist only in local state. The guard keeps it to one write
   * per capture, and `SyncService` upserts on `captureId`, so a later call with
   * a translation updates the same row rather than adding another.
   */
  const savedRef = useRef(false);

  /**
   * Rate limit for re-renders.
   *
   * TTS is metered work, and a user who is not happy with a voice will tap
   * Convert or Regenerate several times in a few seconds. The in-flight guard
   * stops a double submission within one tap; this stops the burst.
   *
   * Silent by design: `stage` already shows a spinner for the in-flight case,
   * and a visible countdown on a button the user is holding down reads as a
   * glitch rather than a limit.
   */
  const rerollRef = useRef(0);
  const renderCooldownUntilRef = useRef(0);
  const renderCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const startRenderCooldown = useCallback((): boolean => {
    // Returns true when a render was *refused* because one just happened.
    const now = Date.now();
    if (now < renderCooldownUntilRef.current) return true;

    renderCooldownUntilRef.current = now + RENDER_COOLDOWN_MS;
    if (renderCooldownTimerRef.current) {
      clearTimeout(renderCooldownTimerRef.current);
    }
    renderCooldownTimerRef.current = setTimeout(() => {
      renderCooldownUntilRef.current = 0;
      renderCooldownTimerRef.current = null;
    }, RENDER_COOLDOWN_MS);
    return false;
  }, []);

  useEffect(() => {
    return (): void => {
      if (renderCooldownTimerRef.current) {
        clearTimeout(renderCooldownTimerRef.current);
      }
    };
  }, []);
  const archiveIfUnsaved = useCallback((): void => {
    if (savedRef.current) return;
    const text = draftTranscriptRef.current.trim();
    if (!text) return;
    savedRef.current = true;
    recordStudioCapture({
      captureId: getCaptureId(),
      input: sourceAudio ? "audio" : "text",
      transcript: text,
      translation: draftTranslationRef.current.trim() || null,
      durationSeconds: Math.round(
        (sourceAudio?.durationMs ?? artifactDurationMs) / 1000,
      ),
      resolvedSourceLang: resolvedSourceLangRef.current,
      spokenLang: resolvedTargetLangRef.current,
    });
  }, [sourceAudio, artifactDurationMs, recordStudioCapture, getCaptureId]);

  /**
   * Publish what the conversion produced and mark it archived.
   *
   * The worker computes the transcript and the translation on every call and
   * hands both back; before this they were read only to build the history row
   * and thrown away, which is why the result could not show the words it was
   * sending. They are now the result's content, and the single source the
   * editor starts from.
   */
  const publishResult = useCallback(
    (args: {
      transcript: string;
      translation: string | null;
      sourceLang: string;
      targetLang: string;
    }): void => {
      setTranscript(args.transcript);
      setTranslation(args.translation);
      setEditDraft(null);
      resolvedSourceLangRef.current = args.sourceLang;
      resolvedTargetLangRef.current = args.targetLang;
      draftTranscriptRef.current = args.transcript;
      draftTranslationRef.current = args.translation ?? "";
    },
    [],
  );

  const runConvert = useCallback(
    async (source: { text?: string } | { audio: CommittedRecording }) => {
      convertAbortRef.current?.abort();
      const controller = new AbortController();
      convertAbortRef.current = controller;

      const seq = ++convertSeqRef.current;
      Keyboard.dismiss();
      setStage("converting");
      setArtifactUri(null);
      setArtifactDurationMs(0);
      setAmplitudes(undefined);

      const wantsTranslation =
        !!targetLang && targetLang !== "none" && targetLang !== "auto";
      const targetSpeechLang = wantsTranslation ? targetLang : sourceSpeechLang;

      if ("audio" in source) {
        const { uri, durationMs } = source.audio;
        setTranscript("");
        setTranslation(null);
        setAmplitudes(undefined);

        const audioSpan = startSpan("studio.synth.upload");
        const result = await synthesizeAudio(
          { uri, durationMs },
          sourceLang,
          targetSpeechLang,
          {
            signal: controller.signal,
            voiceId: voice.slot.id,
            gender: voice.gender,
          },
        );
        audioSpan.end();

        if (seq !== convertSeqRef.current) {
          if (result.ok) void cleanAudioArtifacts(result.value.uri);
          return;
        }

        // A newer conversion owns the screen now, so this one must not restore
        // anything — the abort is ours, not a failure worth reporting.
        if (!result.ok && result.error === EkweError.INTERRUPTED) return;

        if (!result.ok) {
          // The whole chain is one request, so a failure here means the
          // transcript was never produced. Replaying the recording would look
          // like a successful convert while showing the user's own voice.
          logger.warn("[VoiceStudio] audio convert failed:", result.error);
          const entitlement = result.error === EkweError.PREMIUM_REQUIRED;
          const throttled = result.error === EkweError.RATE_LIMITED;
          AppToast.error(
            entitlement
              ? "Pro voice required"
              : throttled
                ? "Please wait"
                : "Convert failed",
            {
              description: entitlement
                ? "Switch to a free voice and try again."
                : throttled
                  ? ErrorMessages[EkweError.RATE_LIMITED]
                  : "Your recording was not converted. Please try again.",
              action: entitlement
                ? {
                    label: "Change voice",
                    onClick: (): void => setIsPickerVisible(true),
                  }
                : undefined,
            },
          );
          setStage("composer");
          return;
        }

        setArtifactDurationMs(result.value.durationMs || durationMs);
        setAmplitudes(normalizeAmplitudes(result.value.waveform ?? []));
        commitArtifact(result.value.uri);
        setArtifactUri(result.value.uri);

        // A worker that predates the transcript field leaves it null, in which
        // case there is nothing meaningful to archive or show, so we keep the
        // recording as the result rather than store a blank row.
        const heardText = result.value.transcript?.trim();
        if (!heardText) return;

        const resolvedSource = result.value.sourceLang || sourceLang || "en";
        const spokenLang = result.value.targetLang || targetSpeechLang;
        const heardTranslation = wantsTranslation
          ? result.value.translation?.trim() || null
          : null;

        publishResult({
          transcript: heardText,
          translation: heardTranslation,
          sourceLang: resolvedSource,
          targetLang: spokenLang,
        });

        savedRef.current = true;
        recordStudioCapture({
          captureId: getCaptureId(),
          input: "audio",
          transcript: heardText,
          translation: heardTranslation,
          durationSeconds: Math.round(durationMs / 1000),
          resolvedSourceLang: resolvedSource,
          spokenLang,
        });
        return;
      }

      const text = source.text ?? "";

      const textSpan = startSpan("studio.synth.text");
      const result = await synthesizeSpeech(text, targetSpeechLang, {
        sourceLang: wantsTranslation ? sourceLang : undefined,
        signal: controller.signal,
        voiceId: voice.slot.id,
        gender: voice.gender,
      });
      textSpan.end();

      if (seq !== convertSeqRef.current) {
        if (result.ok) void cleanAudioArtifacts(result.value.uri);
        return;
      }

      if (!result.ok && result.error === EkweError.INTERRUPTED) return;

      if (!result.ok) {
        // A provider outage is not the user's fault and is worth another go, so
        // it gets its own wording and a retry. A free-tier cooldown is neither
        // an outage nor a failure, and reporting it as one left the user with
        // no idea that waiting was the fix.
        const throttled = result.error === EkweError.RATE_LIMITED;
        const outage = result.error === EkweError.SPEECH_UNAVAILABLE;
        AppToast.error(
          throttled
            ? "Please wait"
            : outage
              ? "Voice temporarily unavailable"
              : "Speech Unavailable",
          {
            description: throttled
              ? ErrorMessages[EkweError.RATE_LIMITED]
              : outage
                ? "Every voice provider is busy right now. Try again in a moment."
                : "Failed to generate speech.",
            action: outage
              ? { label: "Retry", onClick: (): void => void runConvert(source) }
              : undefined,
          },
        );
        setStage("composer");
        return;
      }

      setArtifactDurationMs(result.value.durationMs ?? 0);
      setAmplitudes(normalizeAmplitudes(result.value.waveform ?? []));
      commitArtifact(result.value.uri);
      setArtifactUri(result.value.uri);

      const typedText = result.value.transcript?.trim() || text.trim();
      if (!typedText) return;

      const resolvedSource = result.value.sourceLang || sourceLang || "en";
      const spokenLang = result.value.targetLang || targetSpeechLang;
      const typedTranslation = wantsTranslation
        ? result.value.translation?.trim() || null
        : null;

      publishResult({
        transcript: typedText,
        translation: typedTranslation,
        sourceLang: resolvedSource,
        targetLang: spokenLang,
      });

      savedRef.current = true;
      recordStudioCapture({
        captureId: getCaptureId(),
        input: "text",
        transcript: typedText,
        translation: typedTranslation,
        durationSeconds: 0,
        resolvedSourceLang: resolvedSource,
        spokenLang,
      });
    },
    [
      sourceSpeechLang,
      sourceLang,
      targetLang,
      voice,
      commitArtifact,
      getCaptureId,
      recordStudioCapture,
      publishResult,
    ],
  );

  useEffect(() => {
    if (stage !== "converting" || !artifactUri) return;
    if (player.isReady && !player.isDecoding) {
      setStage("ready");
    }
  }, [stage, artifactUri, player.isReady, player.isDecoding]);

  useEffect(() => {
    if (stage !== "converting" || !artifactUri) return;
    const timer = setTimeout(() => {
      setStage((prev) => (prev === "converting" ? "ready" : prev));
    }, 5000);
    return (): void => {
      clearTimeout(timer);
    };
  }, [stage, artifactUri]);

  const handleConvert = useCallback(() => {
    if (sourceAudio) {
      void triggerHaptic();
      void runConvert({ audio: sourceAudio });
      return;
    }
    const text = sourceText.trim();
    if (!text) return;
    void triggerHaptic();
    void runConvert({ text });
  }, [sourceAudio, sourceText, runConvert]);

  const closeEditor = useCallback((): void => {
    setEditDraft(null);
    setStage("ready");
  }, []);

  const handleBack = useCallback(() => {
    if (isReturnAudioLoading) return;
    void triggerHaptic();
    playerRef.current.pause();
    sourcePlayerRef.current.pause();
    // Leaving the result behind is the one place text can be lost, so archive
    // before the composer takes the screen back.
    archiveIfUnsaved();
    setStage("composer");
  }, [isReturnAudioLoading, archiveIfUnsaved]);

  useEffect(() => {
    if (stage !== "ready" && stage !== "editing") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // Back inside the editor means "put the words back", not "leave".
      if (stage === "editing") {
        closeEditor();
        return true;
      }
      handleBack();
      return true;
    });
    return (): void => {
      sub.remove();
    };
  }, [stage, handleBack, closeEditor]);

  const handleClearSession = useCallback(() => {
    void handleClear();
  }, [handleClear]);

  const handleTogglePlay = useCallback(() => {
    void triggerHaptic();
    if (!artifactUri) return;
    if (player.isPlaying) player.pause();
    else void player.play();
  }, [artifactUri, player]);

  /** The text the result presents as the artifact, and therefore sends. */
  const resultText = translation?.trim() || transcript.trim();

  const handleEditResult = useCallback(() => {
    void triggerHaptic();
    if (!resultText) return;
    setEditDraft({ transcript, translation: translation ?? "" });
    setStage("editing");
  }, [resultText, transcript, translation]);

  const handleEditFieldChange = useCallback(
    (key: "transcript" | "translation", next: string): void => {
      setEditDraft((prev) => (prev ? { ...prev, [key]: next } : prev));
    },
    [],
  );

  const handleCancelEdit = useCallback(() => {
    void triggerHaptic();
    closeEditor();
  }, [closeEditor]);

  /**
   * Render `text` in the current voice and make it the on-screen result.
   *
   * Deliberately omits `sourceLang`, so the service speaks the text instead of
   * translating it. Callers here are the editor and Regenerate, and in both
   * cases the text is already in its final language: the user either typed the
   * final wording, or is re-rolling a render of it. Passing a source language
   * would pay for a machine translation of the user's own words.
   *
   * `asTranslation` decides what the capture records. An edit to a translated
   * result is a correction of the translation, so the original transcript is
   * left alone and the result stays idempotent; an edit to a transcript-only
   * result is a correction of the transcript, and recording it as a
   * translation would be a lie the History screen cannot represent.
   */
  /** Re-renders the result from the editor's draft. See planEdit. */
  const renderInVoice = useCallback(
    async (
      draft: {
        transcript: string;
        translation: string;
      },
      options?: { force?: boolean },
    ): Promise<void> => {
      const spokenLang = resolvedTargetLangRef.current;
      const hasTranslation = !!translation?.trim();
      const plan = planEdit({
        draftTranscript: draft.transcript,
        draftTranslation: draft.translation,
        transcript,
        translation,
      });
      const retranslate = plan.kind === "retranslate";
      const spokenText = plan.kind === "unchanged" ? "" : plan.text;
      // Regenerate speaks the text already on screen, which `planEdit` reports
      // as unchanged; only `force` lets that through to a re-roll.
      if (!spokenText && !options?.force) return;
      const textToSpeak =
        spokenText || draft.translation.trim() || draft.transcript.trim();
      if (!textToSpeak) return;
      // Refused silently. The tap did nothing, and a toast explaining that is
      // worse than the pause it interrupts: Regenerate is a re-roll, and a user
      // who taps it twice is asking for two attempts, not being told off for
      // asking. The cooldown expires in under three seconds.
      if (startRenderCooldown()) return;

      void triggerHaptic();
      // The current artifact is about to be superseded, and commitArtifact
      // deletes the old file on a delay — stop the player before that happens
      // or playback dies mid-note.
      player.pause();

      convertAbortRef.current?.abort();
      const controller = new AbortController();
      convertAbortRef.current = controller;
      const seq = ++convertSeqRef.current;

      // The artifact is dropped below and is not recoverable, so keep it.
      const prevArtifactUri = artifactUri;
      const prevDurationMs = artifactDurationMs;
      const prevAmplitudes = amplitudes;

      setStage("converting");
      setArtifactUri(null);
      setArtifactDurationMs(0);
      setAmplitudes(undefined);

      const restore = (): void => {
        setArtifactUri(prevArtifactUri);
        setArtifactDurationMs(prevDurationMs);
        setAmplitudes(prevAmplitudes);
        setStage("editing");
      };

      const renderSpan = startSpan("studio.synth.render");
      const result = await synthesizeSpeech(textToSpeak, spokenLang, {
        signal: controller.signal,
        voiceId: voice.slot.id,
        gender: voice.gender,
        ...(retranslate ? { sourceLang: resolvedSourceLangRef.current } : {}),
        ...(options?.force
          ? { reroll: (rerollRef.current = (rerollRef.current + 1) % 1000) }
          : {}),
      });
      renderSpan.end();

      if (seq !== convertSeqRef.current) {
        if (result.ok) void cleanAudioArtifacts(result.value.uri);
        return;
      }
      if (!result.ok && result.error === EkweError.INTERRUPTED) {
        restore();
        return;
      }

      if (!result.ok) {
        const throttled = result.error === EkweError.RATE_LIMITED;
        const outage = result.error === EkweError.SPEECH_UNAVAILABLE;
        AppToast.error(
          throttled
            ? "Please wait"
            : outage
              ? "Voice temporarily unavailable"
              : "Speech Unavailable",
          {
            description: throttled
              ? ErrorMessages[EkweError.RATE_LIMITED]
              : outage
                ? "Every voice provider is busy right now. Try again in a moment."
                : "Failed to generate speech.",
            action: outage
              ? {
                  label: "Retry",
                  onClick: (): void => void renderInVoice(draft),
                }
              : undefined,
          },
        );
        restore();
        return;
      }

      setArtifactDurationMs(result.value.durationMs ?? 0);
      setAmplitudes(normalizeAmplitudes(result.value.waveform ?? []));
      commitArtifact(result.value.uri);
      setArtifactUri(result.value.uri);

      const nextTranscript = draft.transcript.trim();
      const nextTranslation = retranslate
        ? result.value.translation?.trim() || null
        : hasTranslation
          ? draft.translation.trim()
          : null;

      // A re-translate that came back with no translation means the audio is of
      // words the card cannot show. Committing the old translation would put the
      // wrong words under the right audio, so refuse and keep what was there.
      if (retranslate && !nextTranslation) {
        void cleanAudioArtifacts(result.value.uri);
        restore();
        AppToast.error("Could not update the translation", {
          description: "Your wording is unchanged. Try again in a moment.",
        });
        return;
      }

      publishResult({
        transcript: nextTranscript,
        translation: nextTranslation,
        sourceLang: resolvedSourceLangRef.current,
        targetLang: spokenLang,
      });

      if (result.value.translationTruncated) {
        AppToast.info("Only part was translated", {
          description:
            "This was longer than one pass allows, so the voice covers the beginning. Shorten it, or send it as shorter messages.",
        });
      }

      savedRef.current = true;
      recordStudioCapture({
        captureId: getCaptureId(),
        input: sourceAudio ? "audio" : "text",
        transcript: nextTranscript,
        translation: nextTranslation,
        durationSeconds: Math.round(
          (sourceAudio?.durationMs ?? artifactDurationMs) / 1000,
        ),
        resolvedSourceLang: resolvedSourceLangRef.current,
        spokenLang,
      });

      setEditDraft(null);
      setStage("ready");
    },
    [
      player,
      voice,
      commitArtifact,
      getCaptureId,
      artifactUri,
      amplitudes,
      publishResult,
      recordStudioCapture,
      sourceAudio,
      artifactDurationMs,
      transcript,
      translation,
      startRenderCooldown,
    ],
  );

  const handleApplyEdit = useCallback(async () => {
    if (!editDraft) return;
    const plan = planEdit({
      draftTranscript: editDraft.transcript,
      draftTranslation: editDraft.translation,
      transcript,
      translation,
    });
    if (plan.kind === "unchanged") {
      closeEditor();
      return;
    }
    await renderInVoice(editDraft);
  }, [editDraft, transcript, translation, renderInVoice, closeEditor]);

  /**
   * Re-roll the render of what is on screen.
   *
   * Re-running the full conversion from `transcript` would have quietly undone
   * an edit: the edited text is not in the transcript when a translation is in
   * play, so Regenerate threw the user's wording away and replaced it with a
   * fresh machine translation. Re-rendering the displayed text cannot lose work.
   */
  const handleReConvert = useCallback(() => {
    void triggerHaptic();
    const text = resultText.trim();
    if (text) {
      // Re-rolls whatever is on screen. With a translation that is the
      // translation, and the transcript is left alone; without one the result
      // *is* the transcript, so re-rolling it must not be recorded as a
      // translation.
      void renderInVoice(
        {
          transcript: translation ? transcript : text,
          translation: translation ? text : "",
        },
        { force: true },
      );
      return;
    }
    if (sourceAudio) {
      void runConvert({ audio: sourceAudio });
      return;
    }
    const typed = sourceText.trim();
    if (typed) void runConvert({ text: typed });
  }, [
    resultText,
    transcript,
    translation,
    sourceAudio,
    sourceText,
    runConvert,
    renderInVoice,
  ]);

  const handleShare = useCallback(async () => {
    void triggerHaptic();
    await ShareOutService.shareArtifact(
      artifactUri,
      resultText,
      "speech-studio",
    );
  }, [artifactUri, resultText]);

  const handlePreviewVoice = useCallback(
    async (previewed: VoiceSelection): Promise<void> => {
      await triggerHaptic();
      preview.preview(previewed);
    },
    [preview],
  );

  const clearVoicePreview = useCallback(() => {
    preview.reset();
  }, [preview]);

  const handleClosePicker = useCallback(() => {
    setIsPickerVisible(false);
    clearVoicePreview();
  }, [clearVoicePreview]);

  const runConvertRef = useRef(runConvert);
  useEffect(() => {
    runConvertRef.current = runConvert;
  });
  const scheduleConvert = useCallback(
    (source: { text?: string } | { audio: CommittedRecording }): void => {
      // Retire any in-flight conversion now rather than when the debounce
      // fires, otherwise a slow reply for the previous voice can land during
      // the delay and overwrite the voice the user just picked.
      convertAbortRef.current?.abort();
      convertAbortRef.current = null;
      convertSeqRef.current += 1;
      cancelScheduledConvert();
      // Show progress straight away so the tap feels acknowledged instead of
      // leaving the previous result on screen for the length of the debounce.
      Keyboard.dismiss();
      setStage("converting");
      setArtifactUri(null);
      setArtifactDurationMs(0);
      setAmplitudes(undefined);
      convertDebounceRef.current = setTimeout((): void => {
        convertDebounceRef.current = null;
        // Read through the ref so the timer cannot apply a stale voice.
        void runConvertRef.current(source);
      }, CONVERT_DEBOUNCE_MS);
    },
    [cancelScheduledConvert],
  );

  const handleGenderChange = useCallback(
    (next: VoiceGender) => {
      // Stop anything sounding before the tab moves, so a preview of the
      // gender being left cannot start playing under the new one.
      preview.cancel();
      settingsActions.setVoiceGender(next);
    },
    [preview],
  );

  const handleSelectVoice = useCallback(
    (selected: VoiceSelection) => {
      void triggerHaptic();
      settingsActions.setVoiceId(selected.slot.id);
      settingsActions.setVoiceGender(selected.gender);
      setIsPickerVisible(false);
      clearVoicePreview();
      if (stage !== "ready") return;
      if (sourceAudio) {
        scheduleConvert({ audio: sourceAudio });
      } else {
        const text = transcript.trim();
        if (text) scheduleConvert({ text });
      }
    },
    [stage, sourceAudio, transcript, scheduleConvert, clearVoicePreview],
  );

  const handleSourceChange = useCallback((lang: string) => {
    setSourceLang(lang);
    // Picking your own language as the target would ask the worker to translate
    // a language into itself.
    setTargetLang((prev) => (prev === lang ? "" : prev));
  }, []);

  const handleTargetChange = useCallback((lang: string) => {
    setTargetLang(lang);
  }, []);

  const handleSwap = useCallback(async () => {
    if (
      sourceLang === "auto" ||
      targetLang === "none" ||
      targetLang === "" ||
      sourceLang === targetLang
    )
      return;
    await triggerHaptic();
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  }, [sourceLang, targetLang]);

  const handleDictate = useCallback(async () => {
    if (dictatingRef.current) return;
    dictatingRef.current = true;
    try {
      await handleClear();
      await startDictation(sourceLang, false);
    } finally {
      dictatingRef.current = false;
    }
  }, [handleClear, startDictation, sourceLang]);

  const handleConfirmDictation = useCallback(() => {
    const committed = commitRecording();
    if (!committed) return;
    rememberSessionFile(committed.uri);
    setSourceAudio(committed);
    setSourceText("");
    void runConvert({ audio: committed });
  }, [commitRecording, rememberSessionFile, runConvert]);

  const handleInputChange = useCallback((text: string) => {
    setSourceText(text);
    setSourceAudio((prev) => (prev ? null : prev));
  }, []);

  useImperativeHandle(ref, () => ({ clear: handleClear }));

  const sourceLabel = getLanguageName(sourceLang);
  const langLabel =
    sourceLang === targetLang
      ? sourceLabel
      : `${sourceLabel} → ${getLanguageName(targetLang)}`;

  /** One field per document that exists, so a recording with a translation has two. */
  const editFields = useMemo<EditableField[]>(() => {
    const draft = editDraft ?? {
      transcript,
      translation: translation ?? "",
    };
    const fields: EditableField[] = [];
    if (translation?.trim()) {
      fields.push({
        key: "translation",
        label: getLanguageName(targetLang),
        a11yLabel: "Translation",
        value: draft.translation,
      });
    }
    fields.push({
      key: "transcript",
      label: sourceAudio ? "What you said" : "What you typed",
      value: draft.transcript,
    });
    return fields;
  }, [editDraft, transcript, translation, sourceAudio, targetLang]);

  const editHint = useMemo(() => {
    if (!translation?.trim()) return "Renders these words in your voice";
    if (!editDraft) return "";
    if (editDraft.translation.trim() !== (translation ?? "").trim()) {
      return "Speaks your wording in your voice";
    }
    return editDraft.transcript.trim() !== transcript.trim()
      ? "Re-translates and re-renders in your voice"
      : "Renders these words in your voice";
  }, [translation, editDraft, transcript]);

  return (
    <Animated.View
      layout={LinearTransition.springify()}
      style={{
        paddingHorizontal: spacing.md,
        gap: spacing.md,
        marginBottom: spacing["7xl"],
      }}
    >
      <Box
        style={
          stage === "ready" || stage === "editing"
            ? { display: "none" }
            : undefined
        }
      >
        <ExpressiveInput
          value={sourceText}
          onChangeText={handleInputChange}
          onClear={handleClear}
          onMicPress={handleDictate}
          onConvert={handleConvert}
          canConvert={sourceText.trim().length > 0}
          hasRecording={sourceAudio !== null}
          recordingUri={sourceAudio?.uri ?? null}
          recordingPeaks={sourceAudio?.waveform}
          recordingPlayer={sourcePlayer}
          onDeleteAudio={handleDeleteAudio}
          isConverting={stage === "converting"}
          isDormant={stage === "ready"}
          dictationState={{
            status: dictationStatus,
            amplitude,
            elapsedMs,
            maxDurationMs,
            capturedDurationMs,
            onStop: stopDictation,
            onConfirm: handleConfirmDictation,
            onCancel: handleCancelDictation,
            capturedUri,
            meteringData,
            interimText,
            finalText,
            isLive,
          }}
          sourceLang={sourceLang}
          targetLang={targetLang}
          onSwap={handleSwap}
          onSourceChange={handleSourceChange}
          onTargetChange={handleTargetChange}
          onFocus={() => onInputFocusChange?.(true)}
          onBlur={() => onInputFocusChange?.(false)}
        />
      </Box>

      {(stage === "ready" || stage === "editing") && (
        <VoiceResultPanel
          player={player}
          voice={voice.slot}
          voiceGender={voice.gender}
          langName={langLabel}
          durationSeconds={
            artifactDurationMs > 0
              ? artifactDurationMs / 1000
              : estimateDuration(transcript || sourceText)
          }
          amplitudes={amplitudes}
          isAudioLoading={isReturnAudioLoading}
          // The result is a document, not a player: the text is the artifact
          // being sent and the audio is its read-aloud. The card's single
          // "Edit text" action is how you correct the wording.
          resultText={resultText}
          transcriptText={transcript}
          hasTranslation={!!translation?.trim()}
          editFields={editFields}
          editHint={editHint}
          onEditResult={handleEditResult}
          isEditing={stage === "editing"}
          canEditText={sourceAudio !== null}
          maxChars={permissions.textTranslationMaxChars}
          onEditFieldChange={handleEditFieldChange}
          onCancelEdit={handleCancelEdit}
          onApplyEdit={() => void handleApplyEdit()}
          onBack={handleBack}
          onChangeVoice={() => {
            void triggerHaptic();
            setIsPickerVisible(true);
          }}
          onRegenerate={handleReConvert}
          onShare={handleShare}
          onClear={handleClearSession}
          onTogglePlay={handleTogglePlay}
        />
      )}

      <VoicePickerSheet
        visible={isPickerVisible}
        onClose={handleClosePicker}
        currentVoiceId={voice.slot.id}
        currentGender={voice.gender}
        onGenderChange={handleGenderChange}
        onSelect={handleSelectVoice}
        onPreview={handlePreviewVoice}
        activePreviewKey={preview.activeKey}
        previewPhase={preview.phase}
      />
    </Animated.View>
  );
});
