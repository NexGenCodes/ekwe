import { useValue } from "@legendapp/state/react";
import { useState, useCallback, useEffect, useRef } from "react";

import { useTranslation } from "@/hooks/useTranslation";

import { settings$, HistoryEntry, history$ } from "@/store";
import { AppToast } from "@/utils/toast";
import { EkweError, ErrorMessages } from "@/constants/errors";
import { getDefaultSourceLang } from "@/utils/languageUtils";

export interface UseResultPipelineProps {
  entryId?: string;
  initialTranscript?: string;
  initialSourceLang?: string;
  initialTargetLang?: string;
  isHistoryReplay?: boolean;
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

/**
 * Backs the `/result` sheet, which is a viewer for an entry already in History.
 *
 * This used to also transcribe an incoming audio file and archive the result.
 * That path is gone: sharing audio now runs through `/share` → Echo, and the
 * only navigation to `/result` passes `isHistoryReplay`, which suppressed the
 * transcription branch and both of its history writes. What remains is
 * hydration from the store plus an on-demand translation, neither of which
 * writes to History — the entry it is showing is already there.
 */
export const useResultPipeline = ({
  entryId,
  initialTranscript = "",
  initialSourceLang,
  initialTargetLang,
  isHistoryReplay = false,
}: UseResultPipelineProps): UseResultPipelineReturn => {
  const foundEntry = useValue(() =>
    entryId ? history$[entryId].get() : null,
  ) as HistoryEntry | null;

  const defaultSourceLang = useValue(() =>
    settings$.selectedLanguages[0].get(),
  );
  const defaultTargetLang = useValue(() => settings$.targetLanguage.get());
  // An entry that resolved from the store is a replay even when the caller
  // did not say so — which is the normal case, since `/result` is opened from
  // History.
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

  // Retained for the route's contract; no capture ever happens here now.
  const isProcessing = false;
  const hasPolished = false;
  const [isTranslating, setIsTranslating] = useState(false);

  const { translate } = useTranslation();

  const handleTranslate = useCallback(async (): Promise<void> => {
    if (!transcript) return;
    setIsTranslating(true);
    try {
      const result = await translate(transcript, sourceLang, targetLang);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setTranslation(result.value.translation);
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
  }, [transcript, sourceLang, targetLang, translate]);

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
