import { useSelector } from "@legendapp/state/react";
import { File as ExpoFile } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { triggerHaptic } from "@/utils/haptics";
import { useState, useCallback, useEffect, useRef } from "react";

import { useTranslation } from "./useTranslation";

import { batchTranscriber } from "@/services/BatchTranscriber";
import { HistoryService } from "@/services/HistoryService";
import { settings$, auth$, HistoryEntry, history$ } from "@/store";
import { AppToast } from "@/utils/toast";
import { default as logger } from "@/utils/logger";

export interface UseResultPipelineProps {
  uri?: string;
  entryId?: string;
  initialTranscript?: string;
  initialSourceLang?: string;
  initialTargetLang?: string;
  isHistoryReplay?: boolean;
  sourceApp?: string;
}

export interface UseResultPipelineReturn {
  transcript: string;
  translation: string | null;
  sourceLang: string;
  targetLang: string;
  isProcessing: boolean;
  hasPolished: boolean;
  isTranslating: boolean;
  isHistoryReplay: boolean;
  handleTranslate: () => Promise<void>;
}

export const useResultPipeline = ({
  uri,
  entryId,
  initialTranscript = "",
  initialSourceLang,
  initialTargetLang,
  isHistoryReplay = false,
  sourceApp,
}: UseResultPipelineProps): UseResultPipelineReturn => {
  const userSession = useSelector(() => auth$.session.get());

  // Watch for the specific entry if entryId exists
  const foundEntry = useSelector(() =>
    entryId ? history$[entryId].get() : null,
  ) as HistoryEntry | null;

  const defaultSourceLang = useSelector(() =>
    settings$.selectedLanguages[0].get(),
  );
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const isReplay = !!foundEntry || isHistoryReplay;

  const [transcript, setTranscript] = useState(
    foundEntry?.transcript || initialTranscript,
  );
  const [translation, setTranslation] = useState<string | null>(
    foundEntry?.translation || null,
  );
  const [sourceLang] = useState(
    foundEntry?.sourceLang || initialSourceLang || defaultSourceLang || "en",
  );
  const [targetLang] = useState(
    foundEntry?.targetLang || initialTargetLang || defaultTargetLang || "es",
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPolished, setHasPolished] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  // Defer transaction refs
  const savedRef = useRef(false);
  const transcriptRef = useRef(transcript);
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);
  const userSessionRef = useRef(userSession);
  const durationRef = useRef(0);

  useEffect(() => {
    transcriptRef.current = transcript;
    sourceLangRef.current = sourceLang;
    targetLangRef.current = targetLang;
    userSessionRef.current = userSession;
  }, [transcript, sourceLang, targetLang, userSession]);

  const { translate } = useTranslation();

  const processSharedAudio = useCallback(
    async (audioUri: string): Promise<void> => {
      setIsProcessing(true);
      try {
        const txResultResponse = await batchTranscriber.transcribe(
          { uri: audioUri, durationMs: 0, meteringData: [], waveform: [] },
          sourceLang,
        );

        if (!txResultResponse.ok) {
          throw new Error(txResultResponse.error);
        }

        const txResult = txResultResponse.value;
        durationRef.current = txResult.durationSeconds;
        setTranscript(txResult.transcript);

        // Clean up file system
        try {
          new ExpoFile(audioUri).delete();
        } catch {
          /* file may not exist */
        }

        triggerHaptic(Haptics.NotificationFeedbackType.Success);
        setHasPolished(true);
      } catch (err) {
        AppToast.error("Translation failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [sourceLang],
  );

  useEffect(() => {
    if (uri && !hasPolished && !isProcessing && !isReplay) {
      processSharedAudio(uri as string);
    }
  }, [uri, hasPolished, isProcessing, isReplay, processSharedAudio]);

  // Save transcription on unmount if it wasn't saved yet
  useEffect(() => {
    return (): void => {
      if (!savedRef.current && transcriptRef.current.trim() && !isReplay) {
        savedRef.current = true;
        HistoryService.recordTranslation(
          {
            sourceLang: sourceLangRef.current,
            targetLang: targetLangRef.current,
            transcript: transcriptRef.current,
            translation: null,
            transliteration: null,
            duration: durationRef.current,
            sourceApp: sourceApp || "shared",
            provider: "gemini",
            sessionKey: uri,
          },
          userSessionRef.current as Parameters<
            typeof HistoryService.recordTranslation
          >[1],
        ).catch((e) =>
          logger.error(
            "Failed to save shared audio transcription on unmount",
            e,
          ),
        );
      }
    };
  }, [isReplay, sourceApp, uri]);

  const handleTranslate = async (): Promise<void> => {
    if (!transcript) return;
    setIsTranslating(true);
    try {
      const trResultResponse = await translate(
        transcript,
        sourceLang,
        targetLang,
      );

      if (!trResultResponse.ok) {
        throw new Error(trResultResponse.error);
      }

      const val = trResultResponse.value;
      setTranslation(val.translation);
      triggerHaptic(Haptics.NotificationFeedbackType.Success);

      if (!isReplay) {
        savedRef.current = true;
        await HistoryService.recordTranslation(
          {
            sourceLang,
            targetLang,
            transcript,
            translation: val.translation,
            transliteration: val.transliteration ?? null,
            duration: durationRef.current,
            sourceApp: sourceApp || "shared",
            provider: "gemini",
            sessionKey: uri,
          },
          userSession as Parameters<typeof HistoryService.recordTranslation>[1],
        );
      }
    } catch {
      AppToast.error("Translation Failed", {
        description: "Try again in a moment.",
      });
    } finally {
      setIsTranslating(false);
    }
  };

  return {
    transcript,
    translation,
    sourceLang,
    targetLang,
    isProcessing,
    hasPolished,
    isTranslating,
    isHistoryReplay: isReplay,
    handleTranslate,
  };
};
