import { useSelector } from '@legendapp/state/react';
import { File as ExpoFile } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { useTranscription } from '../useTranscription';
import { useTranslation } from '../useTranslation';

import { ErrorMessages } from '@/constants/errors';
import { HistoryService } from '@/services/HistoryService';
import { settings$, auth$, HistoryEntry, history$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export interface UseResultPipelineProps {
  uri?: string;
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

export const useResultPipeline = ({
  uri,
  entryId,
  initialTranscript = '',
  initialSourceLang,
  initialTargetLang,
  isHistoryReplay = false,
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
    foundEntry?.sourceLang || initialSourceLang || defaultSourceLang || 'en',
  );
  const [targetLang] = useState(
    foundEntry?.targetLang || initialTargetLang || defaultTargetLang || 'es',
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPolished, setHasPolished] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const { transcribe } = useTranscription();
  const { translate } = useTranslation();

  const processSharedAudio = useCallback(
    async (audioUri: string): Promise<void> => {
      setIsProcessing(true);
      try {
        const txResultResponse = await transcribe({
          uri: audioUri,
          durationMs: 0,
          trimStartMs: 0,
          trimEndMs: 0,
          hasSpeech: true,
          averageDb: -40,
          meteringData: [],
        });

        if (!txResultResponse.ok) {
          throw new Error(txResultResponse.error);
        }

        const txResult = txResultResponse.value;

        setTranscript(txResult.transcript);

        // Clean up file system
        try {
          new ExpoFile(audioUri).delete();
        } catch {
          /* file may not exist */
        }

        // Save to history via HistoryService
        await HistoryService.recordTranslation(
          {
            sourceLang: txResult.detectedLang,
            targetLang,
            transcript: txResult.transcript,
            translation: null,
            transliteration: null,
            duration: 0,
            sourceApp: 'ekwe',
            provider: 'gemini',
          },
          userSession as any,
        );

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setHasPolished(true);
      } catch (err) {
        const error = err as Error;
        AppAlert.error(
          'Transcription Failed',
          ErrorMessages[error.message as keyof typeof ErrorMessages] ??
            'Could not process the voice note.',
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [sourceLang, targetLang, entryId, transcribe, userSession],
  );

  useEffect(() => {
    if (uri && !hasPolished && !isProcessing && !isReplay) {
      processSharedAudio(uri as string);
    }
  }, [uri, hasPolished, isProcessing, isReplay, processSharedAudio]);

  const handleTranslate = async (): Promise<void> => {
    if (!transcript) return;
    setIsTranslating(true);
    try {
      const trResultResponse = await translate(
        transcript,
        sourceLang,
        targetLang,
        entryId,
      );

      if (!trResultResponse.ok) {
        throw new Error(trResultResponse.error);
      }

      setTranslation(trResultResponse.value.translation);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      AppAlert.error('Translation Failed', 'Try again in a moment.');
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
