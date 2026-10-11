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
 * `editing` shows the result card while the user edits the translated text.
 * It is a state of the result, not a separate step.
 */
type Stage = "composer" | "converting" | "editing" | "ready" | "re-rendering";

/**
 * Cooldown between re-renders to prevent rapid sequential conversions.
 * Applied only to re-renders, not to new inputs.
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
  // Ensure source and target languages are explicitly different.
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
  /** The translation matching the rendered audio, editable by the user. */
  const [translation, setTranslation] = useState<string | null>(null);
  /** The open editor's working copies. Null when closed. */
  const [editDraft, setEditDraft] = useState<{
    transcript: string;
    translation: string;
  } | null>(null);
  /** URI of the last archived capture for comparison. */
  const [artifactUri, setArtifactUri] = useState<string | null>(null);
  const [artifactDurationMs, setArtifactDurationMs] = useState(0);
  const [amplitudes, setAmplitudes] = useState<number[] | undefined>(undefined);

  const [isPickerVisible, setIsPickerVisible] = useState(false);

  const voice = useMemo(
    () => resolveVoiceSelection(voiceId, voiceGender),
    [voiceId, voiceGender],
  );

  /**
   * The voice key the current clip was rendered with.
   * Marking as dirty avoids re-synthesizing instantly on voice change.
   */
  const [renderedVoiceKey, setRenderedVoiceKey] = useState<string | null>(null);
  const currentVoiceKey = `${voice.slot.id}_${voice.gender}`;
  const isVoiceDirty =
    renderedVoiceKey !== null && renderedVoiceKey !== currentVoiceKey;

  const dictatingRef = useRef(false);
  const convertSeqRef = useRef(0);
  /** Aborts in-flight conversions. */
  const convertAbortRef = useRef<AbortController | null>(null);
  /** Defers voice-change conversions. */
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
   * The capture ID being converted.
   * Updated on new inputs to prevent overwriting existing history rows.
   */
  const captureIdRef = useRef<string | null>(null);
  const getCaptureId = useCallback((): string => {
    captureIdRef.current ??= Crypto.randomUUID();
    return captureIdRef.current;
  }, []);
  const resetCaptureId = useCallback((): void => {
    captureIdRef.current = null;
  }, []);

  // Mirrors of the draft text to avoid state dependency loops in archiving.
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
  const handlePreviewError = useCallback((error: EkweError): void => {
    AppToast.error("Preview Unavailable", {
      description: ErrorMessages[error],
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
   * Archives a Studio capture's text content.
   * Audio is not kept as it is a temporary render of the archived text.
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
   * Archives text once per capture.
   * Prevents duplicate history rows via `SyncService` upserts.
   */
  const savedRef = useRef(false);

  /** Silent rate limit for re-renders to prevent rapid API calls. */
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

  /** Publishes conversion results and marks them archived. */
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
      const isReRender = stage === "ready" || stage === "editing";
      setStage(isReRender ? "re-rendering" : "converting");
      if (!isReRender) {
        setArtifactUri(null);
        setArtifactDurationMs(0);
        setAmplitudes(undefined);
      }

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

        // Ignore aborts for superseded requests.
        if (!result.ok && result.error === EkweError.INTERRUPTED) return;

        if (!result.ok) {
          // Log audio conversion failures without failing back to source replay.
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
        setRenderedVoiceKey(currentVoiceKey);

        // Discard results with empty transcripts.
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
        // Provide specific error feedback based on failure reasons.
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
      setRenderedVoiceKey(currentVoiceKey);

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
      stage,
      voice,
      currentVoiceKey,
      commitArtifact,
      getCaptureId,
      recordStudioCapture,
      publishResult,
    ],
  );

  useEffect(() => {
    if ((stage !== "converting" && stage !== "re-rendering") || !artifactUri)
      return;
    if (player.isReady && !player.isDecoding) {
      setStage("ready");
    }
  }, [stage, artifactUri, player.isReady, player.isDecoding]);

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
    // Archive text before navigating back.
    archiveIfUnsaved();
    setStage("composer");
  }, [isReturnAudioLoading, archiveIfUnsaved]);

  useEffect(() => {
    if (stage !== "ready" && stage !== "editing") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // Close editor instead of navigating away.
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

  /** Re-renders the result from the editor's draft. */
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
      // Ignore regenerates of unchanged text unless forced.
      if (!spokenText && !options?.force) return;
      const textToSpeak =
        spokenText || draft.translation.trim() || draft.transcript.trim();
      if (!textToSpeak) return;
      // Rate limit renders silently.
      if (startRenderCooldown()) return;

      void triggerHaptic();
      // Pause player before artifact file is deleted.
      player.pause();

      convertAbortRef.current?.abort();
      const controller = new AbortController();
      convertAbortRef.current = controller;
      const seq = ++convertSeqRef.current;

      // The artifact is dropped below and is not recoverable, so keep it.
      const prevArtifactUri = artifactUri;
      const prevDurationMs = artifactDurationMs;
      const prevAmplitudes = amplitudes;

      setStage("re-rendering");
      // Keep existing artifact info on screen instead of wiping it

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
      setRenderedVoiceKey(currentVoiceKey);

      const nextTranscript = draft.transcript.trim();
      const nextTranslation = retranslate
        ? result.value.translation?.trim() || null
        : hasTranslation
          ? draft.translation.trim()
          : null;

      // Keep previous translation on failed re-translate.
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
      currentVoiceKey,
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

  const handleApplyEditWrapped = useCallback(() => {
    void handleApplyEdit();
  }, [handleApplyEdit]);

  const handleOpenVoicePicker = useCallback(() => {
    void triggerHaptic();
    setIsPickerVisible(true);
  }, []);

  /** Re-speaks displayed text with the selected voice. */
  const handleConvertInVoice = useCallback(() => {
    void triggerHaptic();
    const text = resultText.trim();
    if (text) {
      // Re-render draft translation or transcript based on current state.
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

  const handleGenderChange = useCallback(
    (next: VoiceGender) => {
      // Cancel active previews before changing gender.
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
      // Avoid immediate re-synthesis; relies on the 'Convert' button.
    },
    [clearVoicePreview],
  );

  const handleSourceChange = useCallback((lang: string) => {
    setSourceLang(lang);
    // Clear target language if it matches the new source.
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

  /** Render edit fields based on available text data. */
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

  /**
   * ExpressiveInput is memoised, so this has to be a stable reference: a fresh
   * object literal here would re-render the whole dictation tree on every
   * Studio render, even when nothing it reads changed.
   */
  const dictationState = useMemo(
    () => ({
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
    }),
    [
      dictationStatus,
      amplitude,
      elapsedMs,
      maxDurationMs,
      capturedDurationMs,
      stopDictation,
      handleConfirmDictation,
      handleCancelDictation,
      capturedUri,
      meteringData,
      interimText,
      finalText,
      isLive,
    ],
  );

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
          stage === "ready" || stage === "editing" || stage === "re-rendering"
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
          dictationState={dictationState}
          sourceLang={sourceLang}
          targetLang={targetLang}
          onSwap={handleSwap}
          onSourceChange={handleSourceChange}
          onTargetChange={handleTargetChange}
          onFocus={() => onInputFocusChange?.(true)}
          onBlur={() => onInputFocusChange?.(false)}
        />
      </Box>

      {(stage === "ready" ||
        stage === "editing" ||
        stage === "re-rendering") && (
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
          maxChars={permissions.textTranslationMaxChars}
          onEditFieldChange={handleEditFieldChange}
          onCancelEdit={handleCancelEdit}
          onApplyEdit={handleApplyEditWrapped}
          onBack={handleBack}
          onChangeVoice={handleOpenVoicePicker}
          onConvert={handleConvertInVoice}
          canConvert={isVoiceDirty}
          onShare={handleShare}
          onClear={handleClearSession}
          onTogglePlay={handleTogglePlay}
          isConverting={stage === "re-rendering"}
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
