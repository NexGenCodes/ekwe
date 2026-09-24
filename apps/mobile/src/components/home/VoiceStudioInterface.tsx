import { useValue } from "@legendapp/state/react";
import { VOICE_PREVIEW_TEXT, type Voice } from "@ekwe/shared";

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
import { VoicePickerSheet } from "@/components/home/VoicePickerSheet";
import { VoiceResultPanel } from "@/components/home/VoiceResultPanel";

import { Box } from "@/components/ui";
import { getLanguageName } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import { usePermissions, useVoiceDictation } from "@/hooks";
import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { ShareOutService } from "@/services/shareOutService";
import { synthesizeAudio, synthesizeSpeech } from "@/services/speech";
import { settings$, settingsActions } from "@/store";
import { triggerHaptic } from "@/utils";
import { cleanAudioArtifacts } from "@/utils/audioCache";
import { normalizeAmplitudes } from "@/utils/waveform";
import { resolveActiveVoice } from "@/utils/voices";
import { shareVoiceNoteToWhatsApp } from "@/services/whatsAppShareService";
import { AppToast } from "@/utils/toast";
import { AppAlert } from "@/utils/alert";

import logger from "@/utils/logger";

export interface VoiceStudioInterfaceProps {
  onInputFocusChange?: (focused: boolean) => void;
}

export interface VoiceStudioInterfaceRef {
  clear: () => Promise<void>;
}

type Stage = "composer" | "converting" | "ready";

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

  const initialSourceLang = permissions.autoLanguageDetect
    ? "auto"
    : (selectedLanguages[0] ?? "en");

  const [sourceLang, setSourceLang] = useState(initialSourceLang);
  const [targetLang, setTargetLang] = useState(() => {
    const fallback = selectedLanguages[0] ?? "en";
    return defaultTargetLang && selectedLanguages.includes(defaultTargetLang)
      ? defaultTargetLang
      : fallback;
  });
  const [sourceText, setSourceText] = useState("");

  const [stage, setStage] = useState<Stage>("composer");
  const [sourceAudio, setSourceAudio] = useState<CommittedRecording | null>(
    null,
  );
  const [transcript, setTranscript] = useState("");
  const [artifactUri, setArtifactUri] = useState<string | null>(null);
  const [artifactDurationMs, setArtifactDurationMs] = useState(0);
  const [amplitudes, setAmplitudes] = useState<number[] | undefined>(undefined);

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewPlayer = useSharedAudioPlayer(previewUri);

  useEffect(() => {
    if (
      isPreviewLoading &&
      previewUri &&
      previewPlayer.isLoaded &&
      !previewPlayer.isDecoding
    ) {
      setIsPreviewLoading(false);
      void previewPlayer.playFromStart();
    }
  }, [
    isPreviewLoading,
    previewUri,
    previewPlayer.isLoaded,
    previewPlayer.isDecoding,
    previewPlayer,
  ]);

  const [isPickerVisible, setIsPickerVisible] = useState(false);

  const voice = useMemo(
    () => resolveActiveVoice(voiceId, voiceGender),
    [voiceId, voiceGender],
  );

  const dictatingRef = useRef(false);
  const convertSeqRef = useRef(0);

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
    !!sourceAudio && (!sourcePlayer.isLoaded || sourcePlayer.isDecoding);

  const sourceSpeechLang = sourceLang === "auto" ? "en" : sourceLang;

  const playerRef = useRef(player);
  const previewPlayerRef = useRef(previewPlayer);
  const sourcePlayerRef = useRef(sourcePlayer);
  useEffect(() => {
    playerRef.current = player;
    previewPlayerRef.current = previewPlayer;
    sourcePlayerRef.current = sourcePlayer;
  });
  useEffect(() => {
    return (): void => {
      playerRef.current.pause();
      previewPlayerRef.current.pause();
      sourcePlayerRef.current.pause();
    };
  }, []);

  const sessionFilesRef = useRef<Set<string>>(new Set());
  const rememberSessionFile = useCallback((uri?: string | null): void => {
    if (uri) sessionFilesRef.current.add(uri);
  }, []);
  const deleteSessionFile = useCallback((uri?: string | null): void => {
    if (!uri) return;
    sessionFilesRef.current.delete(uri);
    setTimeout((): void => {
      void cleanAudioArtifacts(uri);
    }, 400);
  }, []);
  const purgeSessionFiles = useCallback((): void => {
    const uris = Array.from(sessionFilesRef.current);
    sessionFilesRef.current.clear();
    if (uris.length === 0) return;
    setTimeout((): void => {
      void Promise.all(uris.map((uri) => cleanAudioArtifacts(uri)));
    }, 400);
  }, []);

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
    player.pause();
    previewPlayer.pause();
    sourcePlayer.pause();
    activeArtifactRef.current = null;
    setSourceText("");
    setTranscript("");
    setSourceAudio(null);
    setArtifactUri(null);
    setArtifactDurationMs(0);
    setAmplitudes(undefined);
    setPreviewUri(null);
    setIsPreviewLoading(false);
    setStage("composer");
    purgeSessionFiles();
  }, [player, previewPlayer, sourcePlayer, purgeSessionFiles]);

  const handleDeleteAudio = useCallback(async () => {
    await triggerHaptic();
    const uri = sourceAudio?.uri ?? null;
    player.pause();
    sourcePlayer.pause();
    if (activeArtifactRef.current === uri) activeArtifactRef.current = null;
    setSourceAudio(null);
    setArtifactUri(null);
    setArtifactDurationMs(0);
    setAmplitudes(undefined);
    deleteSessionFile(uri);
  }, [player, sourcePlayer, sourceAudio, deleteSessionFile]);

  const handleCancelDictation = useCallback(() => {
    const uri = capturedUri;
    void cancelDictation();
    deleteSessionFile(uri);
  }, [capturedUri, cancelDictation, deleteSessionFile]);

  const runConvert = useCallback(
    async (source: { text?: string } | { audio: CommittedRecording }) => {
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
        const { uri, durationMs, waveform } = source.audio;
        setTranscript("");
        setAmplitudes(undefined);

        const result = await synthesizeAudio(
          { uri, durationMs },
          sourceLang,
          targetSpeechLang,
          { voiceId: voice.id, gender: voice.gender },
        );

        if (seq !== convertSeqRef.current) {
          if (result.ok) void cleanAudioArtifacts(result.value.uri);
          return;
        }

        if (!result.ok) {
          logger.warn(
            "[VoiceStudio] audio synthesis unavailable, keeping recording:",
            result.error,
          );
          setArtifactDurationMs(durationMs);
          setAmplitudes(normalizeAmplitudes(waveform));
          commitArtifact(uri);
          setArtifactUri(uri);
          return;
        }

        setArtifactDurationMs(result.value.durationMs || durationMs);
        setAmplitudes(normalizeAmplitudes(result.value.waveform ?? []));
        commitArtifact(result.value.uri);
        setArtifactUri(result.value.uri);
        return;
      }

      const text = source.text ?? "";
      setTranscript(text);

      const result = await synthesizeSpeech(text, targetSpeechLang, {
        sourceLang: wantsTranslation ? sourceLang : undefined,
      });

      if (seq !== convertSeqRef.current) {
        if (result.ok) void cleanAudioArtifacts(result.value.uri);
        return;
      }

      if (!result.ok) {
        AppToast.error("Speech Unavailable", {
          description: "Failed to generate speech.",
        });
        setStage("composer");
        return;
      }

      setArtifactDurationMs(result.value.durationMs ?? 0);
      setAmplitudes(normalizeAmplitudes(result.value.waveform ?? []));
      commitArtifact(result.value.uri);
      setArtifactUri(result.value.uri);
    },
    [sourceSpeechLang, sourceLang, targetLang, voice, commitArtifact],
  );

  useEffect(() => {
    if (stage !== "converting" || !artifactUri) return;
    if (player.isLoaded && !player.isDecoding) {
      setStage("ready");
    }
  }, [stage, artifactUri, player.isLoaded, player.isDecoding]);

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

  const handleReConvert = useCallback(() => {
    void triggerHaptic();
    if (sourceAudio) {
      void runConvert({ audio: sourceAudio });
      return;
    }
    const text = transcript.trim() || sourceText.trim();
    if (text) void runConvert({ text });
  }, [sourceAudio, transcript, sourceText, runConvert]);

  const handleBack = useCallback(() => {
    if (isReturnAudioLoading) return;
    void triggerHaptic();
    playerRef.current.pause();
    sourcePlayerRef.current.pause();
    setStage("composer");
  }, [isReturnAudioLoading]);

  useEffect(() => {
    if (stage !== "ready") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return (): void => {
      sub.remove();
    };
  }, [stage, handleBack]);

  const handleClearSession = useCallback(() => {
    void handleClear();
  }, [handleClear]);

  const handleTogglePlay = useCallback(() => {
    void triggerHaptic();
    if (!artifactUri) return;
    if (player.isPlaying) player.pause();
    else void player.play();
  }, [artifactUri, player]);

  const handleShare = useCallback(async () => {
    void triggerHaptic();
    const text = transcript.trim();
    if (artifactUri) {
      const shareable = await ShareOutService.ensureShareable(artifactUri);
      const shared = await ShareOutService.shareAudio(
        shareable,
        text || undefined,
      );
      if (!shared && text) await ShareOutService.shareText(text);
      return;
    }
    if (text) await ShareOutService.shareText(text);
  }, [artifactUri, transcript]);

  const handleShareWhatsApp = useCallback(async () => {
    if (!artifactUri) return;
    try {
      await triggerHaptic();
      await shareVoiceNoteToWhatsApp(artifactUri);
    } catch (e) {
      logger.error("WhatsApp share failed", e);
      AppToast.error("Share to WhatsApp failed", {
        description: (e as Error).message,
      });
    }
  }, [artifactUri]);

  const handlePreviewVoice = useCallback(
    async (previewed: Voice) => {
      await triggerHaptic();
      try {
        previewPlayer.pause();
        setIsPreviewLoading(true);
        const result = await synthesizeSpeech(
          VOICE_PREVIEW_TEXT,
          sourceSpeechLang,
          {
            voiceId: previewed.id,
            gender: previewed.gender,
          },
        );
        if (result.ok) {
          const nextUri = result.value.uri;
          rememberSessionFile(nextUri);
          if (previewUri && previewUri !== nextUri) {
            deleteSessionFile(previewUri);
          }
          setPreviewUri(nextUri);
        } else {
          setIsPreviewLoading(false);
          AppToast.error("Preview Unavailable", {
            description: "Failed to load voice preview.",
          });
        }
      } catch {
        setIsPreviewLoading(false);
      }
    },
    [
      sourceSpeechLang,
      previewPlayer,
      previewUri,
      rememberSessionFile,
      deleteSessionFile,
    ],
  );

  const clearVoicePreview = useCallback(() => {
    previewPlayer.pause();
    const uri = previewUri;
    setPreviewUri(null);
    setIsPreviewLoading(false);
    deleteSessionFile(uri);
  }, [previewPlayer, previewUri, deleteSessionFile]);

  const handleClosePicker = useCallback(() => {
    setIsPickerVisible(false);
    clearVoicePreview();
  }, [clearVoicePreview]);

  const handleSelectVoice = useCallback(
    (selected: Voice) => {
      void triggerHaptic();
      settingsActions.setVoiceId(selected.id);
      settingsActions.setVoiceGender(selected.gender);
      setIsPickerVisible(false);
      clearVoicePreview();
      if (stage !== "ready") return;
      if (sourceAudio) {
        void runConvert({ audio: sourceAudio });
      } else {
        const text = transcript.trim();
        if (text) void runConvert({ text });
      }
    },
    [stage, sourceAudio, transcript, runConvert, clearVoicePreview],
  );

  const handleSourceChange = useCallback((lang: string) => {
    setSourceLang(lang);
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

  return (
    <Animated.View
      layout={LinearTransition.springify()}
      style={{
        paddingHorizontal: spacing.md,
        gap: spacing.md,
        marginBottom: spacing["7xl"],
      }}
    >
      <Box style={stage === "ready" ? { display: "none" } : undefined}>
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

      {stage === "ready" && (
        <VoiceResultPanel
          player={player}
          sourceKind={sourceAudio ? "audio" : "text"}
          voice={voice}
          langName={langLabel}
          durationSeconds={
            artifactDurationMs > 0
              ? artifactDurationMs / 1000
              : estimateDuration(transcript || sourceText)
          }
          amplitudes={amplitudes}
          isAudioLoading={isReturnAudioLoading}
          onBack={handleBack}
          onChangeVoice={() => {
            void triggerHaptic();
            setIsPickerVisible(true);
          }}
          onRegenerate={handleReConvert}
          onShare={handleShare}
          onShareWhatsApp={handleShareWhatsApp}
          onClear={handleClearSession}
          onTogglePlay={handleTogglePlay}
        />
      )}

      <VoicePickerSheet
        visible={isPickerVisible}
        onClose={handleClosePicker}
        currentVoiceId={voice.id}
        onSelect={handleSelectVoice}
        onPreview={handlePreviewVoice}
      />
    </Animated.View>
  );
});
