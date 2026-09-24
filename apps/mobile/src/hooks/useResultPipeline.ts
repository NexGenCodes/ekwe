import { useValue } from "@legendapp/state/react";
import { File as ExpoFile } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { triggerHaptic } from "@/utils/haptics";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";
import { useState, useCallback, useEffect, useRef } from "react";

import { useTranslation } from "@/hooks/useTranslation";

import { batchTranscriber } from "@/services/batchTranscriber";
import { HistoryService } from "@/services/historyService";
import { settings$, auth$, HistoryEntry, history$ } from "@/store";
import { AppToast } from "@/utils/toast";
import { EkweError, ErrorMessages } from "@/constants/errors";
import { default as logger } from "@/utils/logger";
import { getDefaultSourceLang } from "@/utils/languageUtils";

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
  const userSession = useValue(() => auth$.session.get());

  const foundEntry = useValue(() =>
    entryId ? history$[entryId].get() : null,
  ) as HistoryEntry | null;

  const defaultSourceLang = useValue(() =>
    settings$.selectedLanguages[0].get(),
  );
  const defaultTargetLang = useValue(() => settings$.targetLanguage.get());
  const isReplay = !!foundEntry || isHistoryReplay;

  const [transcript, setTranscript] = useState(
    foundEntry?.transcript || initialTranscript,
  );
  const [translation, setTranslation] = useState<string | null>(
    foundEntry?.translation || null,
  );
  const [sourceLang, setSourceLang] = useState(
    foundEntry?.sourceLang ||
      initialSourceLang ||
      defaultSourceLang ||
      getDefaultSourceLang(true),
  );
  const [targetLang, setTargetLang] = useState(
    foundEntry?.targetLang || initialTargetLang || defaultTargetLang || "es",
  );

  const appliedEntryIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!foundEntry) return;
    if (appliedEntryIdRef.current === entryId) return;
    appliedEntryIdRef.current = entryId;
    setTranscript(foundEntry.transcript);
    setTranslation(foundEntry.translation);
    setSourceLang(foundEntry.sourceLang || getDefaultSourceLang(true));
    setTargetLang(foundEntry.targetLang || "es");
  }, [foundEntry, entryId]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPolished, setHasPolished] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const attemptedUriRef = useRef<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

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
      if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        setTranscript(txResult.transcript);

        try {
          new ExpoFile(audioUri).delete();
        } catch {
          /* file may not exist */
        }

        triggerHaptic(Haptics.NotificationFeedbackType.Success);
        setHasPolished(true);
        invalidateUsage();
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
    if (uri && !isReplay && !isProcessing && attemptedUriRef.current !== uri) {
      attemptedUriRef.current = uri;
      processSharedAudio(uri);
    }
  }, [uri, isProcessing, isReplay, processSharedAudio]);

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
            type: "transcription",
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
      if (!mountedRef.current) return;
      setTranslation(val.translation);
      triggerHaptic(Haptics.NotificationFeedbackType.Success);

      if (!isReplay) {
        savedRef.current = true;
        try {
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
              type: "translation",
            },
            userSession as Parameters<
              typeof HistoryService.recordTranslation
            >[1],
          );
        } catch (saveErr) {
          savedRef.current = false;
          throw saveErr;
        }
      }
    } catch (e) {
      const code = e instanceof Error ? (e.message as EkweError) : undefined;
      AppToast.error("Translation Failed", {
        description:
          code && ErrorMessages[code]
            ? ErrorMessages[code]
            : "Try again in a moment.",
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
